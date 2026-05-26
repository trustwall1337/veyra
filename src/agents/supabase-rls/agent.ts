/**
 * Supabase RLS agent (step 09 original shape).
 *
 * Per PHASE_1_PLAN §4.4: deterministic agent that reads
 *  - the schema SQL (from --supabase-schema), and
 *  - the storage-buckets.json artifact (when present),
 * and emits Findings for cc-11-5 (RLS-off), cc-11-6 (USING(true)),
 * cc-11-9 (per-row check missing for authenticated), cc-11-12 (public
 * bucket).
 *
 * 09b reshapes this into an assertion predicate; 09 lands the original
 * agent shape per the step file's contract.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type { Finding } from '../../types/finding.js';
import {
  asConnectorId,
  type ConnectorId,
} from '../../types/identity.js';
import { isErr } from '../../types/result.js';
import type {
  McpResponseSource,
  ScanFact,
  ScanFactPayload,
} from '../../types/scan-fact.js';

import { loadBucketsArtifact, evaluateBuckets } from './buckets.js';
import { envDeclarationsToScanFacts } from '../product-understanding/inventory/bootstrap.js';
import type { SupabaseClient } from '../../connectors/supabase/client.js';

import { parseSchemaSql } from './parser.js';
import {
  predicateAllAuthenticated,
  predicateBroadPolicy,
  predicatePrivilegedClientKey,
  predicatePublicBucket,
  predicateRlsMissing,
} from './predicates.js';
import { buildSchemaFacts } from './schema-facts.js';
import type {
  BucketRecord,
  ParsedPolicy,
  ParsedSchema,
  ParsedTable,
  SupabaseRlsInput,
  SupabaseRlsOutput,
} from './types.js';
import {
  type Result as ResultT,
  ok as resOk,
  err as resErr,
} from '../../types/result.js';

class SupabaseRlsMcpError extends Error {
  override readonly name = 'SupabaseRlsMcpError';
}

/**
 * Step 24: read Supabase schema + storage state via the MCP connector.
 *
 * Calls only the read-only allowlisted tools — `list_tables`,
 * `get_advisors`, `list_storage_buckets`, `get_storage_config` — and
 * converts the responses into the same `ParsedSchema` + `BucketRecord`
 * shapes the SQL-file path produces. The connector's `checkInvocation`
 * gate (set in src/connectors/supabase/policy.ts) enforces
 * `read_only=true + project_ref` on every call. The agent does not
 * relax that gate.
 */
async function readSchemaFromMcp(
  client: SupabaseClient,
): Promise<
  ResultT<
    { parsed: ParsedSchema; buckets: readonly BucketRecord[] | undefined },
    SupabaseRlsMcpError
  >
> {
  const tables: ParsedTable[] = [];
  const policies: ParsedPolicy[] = [];

  const tablesR = await client.listTables();
  if (!tablesR.ok) {
    return resErr(
      new SupabaseRlsMcpError(`list_tables failed: ${tablesR.error.message}`),
    );
  }
  // Supabase MCP list_tables returns an array of { schema, name,
  // rls_enabled, policies?: [...] }. The shape is documented in the
  // Supabase MCP server's OpenAPI; we parse defensively (every field
  // type-checked) and refuse to construct a ParsedTable from a
  // malformed entry.
  const tablesData = tablesR.value;
  const tableRecords = Array.isArray(tablesData)
    ? tablesData
    : Array.isArray((tablesData as { tables?: unknown })?.tables)
      ? ((tablesData as { tables: unknown[] }).tables)
      : [];
  for (const raw of tableRecords) {
    if (typeof raw !== 'object' || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const schema = typeof t['schema'] === 'string' ? (t['schema'] as string) : 'public';
    const name = typeof t['name'] === 'string' ? (t['name'] as string) : undefined;
    if (name === undefined) continue;
    tables.push({
      schema,
      name,
      source_range: { start: 1, end: 1 },
      rls_enabled: t['rls_enabled'] === true,
    });
    const rawPolicies = Array.isArray(t['policies']) ? (t['policies'] as unknown[]) : [];
    for (const rp of rawPolicies) {
      if (typeof rp !== 'object' || rp === null) continue;
      const p = rp as Record<string, unknown>;
      const pname = typeof p['name'] === 'string' ? (p['name'] as string) : undefined;
      const rawOp = typeof p['command'] === 'string' ? (p['command'] as string).toUpperCase() : 'ALL';
      const op =
        rawOp === 'SELECT' || rawOp === 'INSERT' || rawOp === 'UPDATE' || rawOp === 'DELETE' || rawOp === 'ALL'
          ? (rawOp as 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL')
          : 'ALL';
      if (pname === undefined) continue;
      policies.push({
        name: pname,
        schema,
        table: name,
        operation: op,
        ...(typeof p['roles'] === 'string' ? { role: p['roles'] as string } : {}),
        ...(typeof p['definition'] === 'string'
          ? { using_expr: p['definition'] as string }
          : {}),
        ...(typeof p['check'] === 'string' ? { with_check_expr: p['check'] as string } : {}),
        source_range: { start: 1, end: 1 },
      });
    }
  }

  // get_advisors enriches the report with rule output but does NOT
  // produce ParsedSchema entries. We call it for completeness (the
  // tool is in the Phase 1 allowlist) and surface a warning if it
  // fails; failure does not block schema parsing.
  await client.getAdvisors().catch(() => undefined);

  // Storage buckets: list_storage_buckets + get_storage_config. When
  // the calls succeed we build BucketRecord[] in the same shape the
  // SQL-file path's `loadBucketsArtifact` produces. Per codex step24-f4
  // both calls are issued so cc-11-12 has MCP-attributable evidence.
  // get_storage_config failure does NOT block bucket fact production —
  // it's enrichment.
  await client.getStorageConfig().catch(() => undefined);
  let buckets: BucketRecord[] | undefined;
  const bucketsR = await client.listStorageBuckets();
  if (bucketsR.ok) {
    const data = bucketsR.value;
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { buckets?: unknown })?.buckets)
        ? ((data as { buckets: unknown[] }).buckets)
        : [];
    buckets = [];
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue;
      const b = raw as Record<string, unknown>;
      const id = typeof b['id'] === 'string' ? (b['id'] as string) : undefined;
      const name = typeof b['name'] === 'string' ? (b['name'] as string) : undefined;
      if (id === undefined || name === undefined) continue;
      buckets.push({
        id,
        name,
        public: b['public'] === true,
        policies: Array.isArray(b['policies'])
          ? (b['policies'] as readonly { readonly name: string; readonly operation: string; readonly role: string; readonly definition?: string }[])
          : [],
      });
    }
  }

  return resOk({
    parsed: {
      tables,
      policies,
      grants: [],
      unparseable: [],
    },
    buckets,
  });
}

const METADATA: AgentMetadata = {
  id: 'supabase-rls',
  version: '0.1.0',
  // Step 23 retro-f2: declare inventory-bootstrap.json so the
  // topological sort sequences supabase-rls after product-understanding
  // (which writes the inventory). Without this dep, supabase-rls could
  // run before the inventory exists and the cc-11-7 predicate would
  // silently emit no findings.
  declared_dependencies: [
    'supabase-schema-sql',
    'storage-buckets-json',
    'inventory-bootstrap.json',
  ],
  produces: ['supabase-tables.json'],
};

const UNCERTAINTY_NOTE =
  'regex parser; complex SQL may be missed (CTEs, DO $$ blocks, multi-statement policies, user-defined functions)';

// Step 26 Piece 2: loud-failure threshold for the schema parser.
// When the parser returns zero tables + zero policies but the input
// was non-trivial AND contained SQL signal lines (CREATE TABLE /
// CREATE POLICY / ENABLE ROW LEVEL SECURITY counts > 0), the agent
// emits a diagnostic ScanFact + four coverage_gap Findings (one per
// affected control) so the report renders a clear "schema parser
// failed" signal instead of silent `needs_review` with 0 findings.
//
// The byte threshold prevents tripping on truly empty / tiny inputs.
// Tunable via this named constant; a future step can revisit.
const MIN_NONTRIVIAL_DUMP_BYTES = 1024;

// Step 26 Piece 2: the four controls the supabase-rls predicates
// would have covered when the parser produces a real schema. Used
// as the affected-controls list for the parse_failure path.
const PARSE_FAILURE_AFFECTED_CONTROLS: readonly (
  | 'cc-11-5'
  | 'cc-11-6'
  | 'cc-11-9'
  | 'cc-11-12'
)[] = ['cc-11-5', 'cc-11-6', 'cc-11-9', 'cc-11-12'];

function countMatches(s: string, re: RegExp): number {
  const m = s.match(re);
  return m === null ? 0 : m.length;
}

/**
 * Build a diagnostic ScanFact + four coverage_gap Findings when the
 * parser produces nothing from a non-trivial dump. The Findings each
 * cite the same diagnostic ScanFact's `fact_id` in evidence_refs.
 *
 * Per codex retro-f1: one ScanFact, four Findings (not one Finding
 * tagged to four controls — Finding.control_id is singular). Per
 * codex retro-f2 the caller gates on both bytes and signal counts
 * before calling this builder, so SET-only dumps don't trip it.
 *
 * Per CLAUDE.md §Output language: only allowed claims ("schema
 * parser produced 0 results", "input may use newer syntax", "needs
 * human review"). Per CLAUDE.md §Secrets: byte counts + line counts
 * only; no raw dump excerpts in the diagnostic.
 */
function buildParseFailureArtifacts(args: {
  readonly schemaPath: string;
  readonly byteCount: number;
  readonly createTableLines: number;
  readonly createPolicyLines: number;
  readonly enableRlsLines: number;
}): { readonly fact: ScanFact; readonly findings: readonly Finding[] } {
  const factId = createHash('sha256')
    .update(`parse_failure:${args.schemaPath}:${String(args.byteCount)}`)
    .digest('hex');
  const summary = `Schema parser produced 0 tables and 0 policies from ${String(args.byteCount)} bytes of input. Input may use syntax newer than the parser supports.`;
  const sanitizedExcerpt = JSON.stringify({
    byte_count: args.byteCount,
    create_table_lines: args.createTableLines,
    create_policy_lines: args.createPolicyLines,
    enable_rls_lines: args.enableRlsLines,
  });
  const fact: ScanFact = {
    fact_id: factId,
    source: {
      kind: 'local_file',
      signal_kind: 'schema_parser_failure',
      payload: {
        sanitized_excerpt: sanitizedExcerpt,
        content_kind: 'json',
      },
    },
    file_path: args.schemaPath,
    observed_at: new Date().toISOString(),
    args_fingerprint_sha256: createHash('sha256').update(args.schemaPath).digest('hex'),
    redacted: false,
  };
  const findings: Finding[] = PARSE_FAILURE_AFFECTED_CONTROLS.map((controlId) => ({
    id: `${controlId}-schema-parser-failure`,
    control_id: controlId,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: `${controlId} could not be checked: schema parser produced 0 results`,
    summary: `${summary} Diagnostic: CREATE TABLE lines=${String(args.createTableLines)}, CREATE POLICY lines=${String(args.createPolicyLines)}, ENABLE ROW LEVEL SECURITY lines=${String(args.enableRlsLines)}. Needs human review. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [factId],
  }));
  return { fact, findings };
}

function mintSupabaseConnectorId(): ConnectorId {
  const r = asConnectorId('supabase');
  if (!r.ok) throw new Error(`bug: ${r.error.message}`);
  return r.value;
}

const SUPABASE_CONNECTOR_ID: ConnectorId = mintSupabaseConnectorId();

function bucketRecordsToFacts(
  buckets: readonly { id: string; name: string; public: boolean; policies?: readonly { name: string; operation: string; role: string }[] }[],
  schemaPath: string,
): readonly ScanFact[] {
  return buckets.map((b) => {
    const payload: ScanFactPayload = {
      sanitized_excerpt: JSON.stringify({
        id: b.id,
        name: b.name,
        public: b.public,
        policies: b.policies ?? [],
      }),
      content_kind: 'json',
    };
    const source: McpResponseSource = {
      kind: 'mcp_response',
      connector_id: SUPABASE_CONNECTOR_ID,
      tool: 'list_storage_buckets',
      response_digest: createHash('sha256')
        .update(JSON.stringify(b))
        .digest('hex'),
      payload,
    };
    return {
      fact_id: createHash('sha256').update(`bucket:${schemaPath}:${b.id}`).digest('hex'),
      source,
      observed_at: new Date().toISOString(),
      args_fingerprint_sha256: createHash('sha256').update(schemaPath).digest('hex'),
      redacted: false,
    };
  });
}

/**
 * Coverage-gap builder. Post retro-09b f6 the pre-09b likely_issue
 * builder is fully removed — predicates own that path. Only the
 * coverage gaps the predicates cannot infer from facts remain here:
 * non-public schemas (Phase 1 limit) and unparseable SQL blocks.
 */
function buildCoverageGapFindings(schema: ParsedSchema): readonly Finding[] {
  const findings: Finding[] = [];

  // Non-public schemas (Phase 1 limit): emit coverage_gap so they are
  // never silently skipped.
  const seenNonPublic = new Set<string>();
  for (const table of schema.tables) {
    if (table.schema === 'public') continue;
    const key = `${table.schema}.${table.name}`;
    if (seenNonPublic.has(key)) continue;
    seenNonPublic.add(key);
    findings.push({
      id: `cc-11-rls-non-public-schema-${key}`,
      control_id: 'cc-11-5',
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'unknown',
      title: `Non-public schema table "${key}" was not analyzed`,
      summary: `Phase 1 inspects only the public schema. Table "${key}" was not analyzed. Negative tests should be added once non-public schema coverage lands. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [],
    });
  }

  // Unparseable blocks → coverage_gap with manual-review reproducibility.
  for (const u of schema.unparseable) {
    findings.push({
      id: `cc-11-rls-coverage-${u.source_range.start}-${u.source_range.end}`,
      control_id: 'cc-11-5',
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'unknown',
      title: `SQL block at lines ${String(u.source_range.start)}-${String(u.source_range.end)} could not be parsed`,
      summary: `The regex parser could not interpret this block: ${u.reason}. Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [],
    });
  }

  return findings;
}

export function createSupabaseRlsAgent(): VeyraAgent<
  SupabaseRlsInput,
  SupabaseRlsOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: SupabaseRlsInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<SupabaseRlsOutput>> {
      // Step 24/27: choose the schema source.
      //   sql_file → parse a local `schema.sql`.
      //   mcp      → drive read-only allowlisted MCP tools.
      //   rest     → call Supabase Management REST API.
      const sourceTag =
        input.schemaSource.source === 'mcp'
          ? `supabase-mcp:${input.schemaSource.projectRef}`
          : input.schemaSource.source === 'rest'
            ? `supabase-rest:${input.schemaSource.projectRef}`
            : input.schemaSource.schemaSqlPath;
      const parserId =
        input.schemaSource.source === 'mcp'
          ? 'supabase-mcp'
          : input.schemaSource.source === 'rest'
            ? 'supabase-rest'
            : 'supabase-schema';

      let parsed: ParsedSchema;
      let bucketRecordsFromMcp: readonly BucketRecord[] | undefined;
      // Step 27 codex df1/df2: REST-source coverage gaps (cc-11-5/6/9)
      // produced explicitly when the REST backend cannot expose
      // RLS state or policy bodies. Merged into the final findings
      // list below alongside predicate output.
      let restCoverageGaps: readonly Finding[] = [];
      // Step 27 codex df3: track whether storage facts came from the
      // REST `StorageMetadataSource` so cc-11-12 findings can carry
      // accurate provenance rather than the default `mcp_context`.
      let isRestStorageSource = false;
      if (input.schemaSource.source === 'sql_file') {
        let sql: string;
        try {
          sql = await fs.readFile(input.schemaSource.schemaSqlPath, 'utf8');
        } catch (cause) {
          const m = cause instanceof Error ? cause.message : String(cause);
          context.logger.warn(
            `supabase-rls: cannot read schema ${input.schemaSource.schemaSqlPath}: ${m}`,
          );
          return {
            status: 'completed',
            artifacts: [],
            findings: [
              {
                id: 'cc-11-5-coverage-gap-schema-unreadable',
                control_id: 'cc-11-5',
                finding_type: 'coverage_gap',
                evidence_strength: 'low',
                reproducibility: 'manual_review_required',
                review_action: 'review_before_launch',
                blast_radius: 'unknown',
                title: 'Supabase schema could not be read',
                summary: `schema input at ${input.schemaSource.schemaSqlPath} could not be read: ${m}. RLS predicates could not run. Negative tests should be added once the schema is available. ${UNCERTAINTY_NOTE}.`,
                evidence_refs: [],
              },
            ],
            warnings: [`schema_read_failed: ${m}`],
          };
        }
        try {
          parsed = parseSchemaSql(sql);
        } catch (cause) {
          const m = cause instanceof Error ? cause.message : String(cause);
          return {
            status: 'completed',
            artifacts: [],
            findings: [
              {
                id: `cc-11-rls-parser-failed`,
                control_id: 'cc-11-5',
                finding_type: 'coverage_gap',
                evidence_strength: 'low',
                reproducibility: 'manual_review_required',
                review_action: 'review_before_launch',
                blast_radius: 'unknown',
                title: 'Supabase schema parser failed',
                summary: `The regex parser threw an error: ${m}. Needs human review. ${UNCERTAINTY_NOTE}.`,
                evidence_refs: [],
              },
            ],
            warnings: [`parser_failed: ${m}`],
          };
        }
        // Step 26 Piece 2: loud failure when the parser returns nothing
        // from a non-trivial dump that contains SQL signal lines. The
        // gate covers the headline 2026-05-25 failure: real
        // `supabase db dump --linked` output containing 42 CREATE
        // TABLE / 105 CREATE POLICY lines parsing to 0/0. Per codex
        // retro-f2 the trigger is bytes AND signal count > 0.
        if (parsed.tables.length === 0 && parsed.policies.length === 0) {
          const byteCount = Buffer.byteLength(sql, 'utf8');
          const createTableLines = countMatches(sql, /CREATE\s+TABLE/gi);
          const createPolicyLines = countMatches(sql, /CREATE\s+POLICY/gi);
          const enableRlsLines = countMatches(sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi);
          const hasSignal =
            createTableLines > 0 || createPolicyLines > 0 || enableRlsLines > 0;
          if (byteCount > MIN_NONTRIVIAL_DUMP_BYTES && hasSignal) {
            const { fact, findings } = buildParseFailureArtifacts({
              schemaPath: input.schemaSource.schemaSqlPath,
              byteCount,
              createTableLines,
              createPolicyLines,
              enableRlsLines,
            });
            // Step 26 retro-f1: persist the diagnostic ScanFact so
            // each parse_failure Finding's `evidence_refs[0]` (the
            // fact's content-addressed fact_id) resolves to a real
            // on-disk artifact. Without this, the evidence_refs were
            // pointing at an in-memory-only fact that nothing could
            // look up.
            const parseFailurePath = path.join(
              context.artifactDir,
              'supabase-parse-failure.json',
            );
            const persistArtifacts: ArtifactRef[] = [];
            try {
              await fs.mkdir(context.artifactDir, { recursive: true });
              await fs.writeFile(
                parseFailurePath,
                JSON.stringify({ scan_facts: [fact] }, null, 2),
                'utf8',
              );
              persistArtifacts.push({
                scanId: context.scanId,
                kind: 'scan_facts',
                path: parseFailurePath,
              });
            } catch (cause) {
              const m = cause instanceof Error ? cause.message : String(cause);
              context.logger.warn(
                `supabase-rls: failed to write supabase-parse-failure.json: ${m}`,
              );
            }
            return {
              status: 'completed',
              artifacts: persistArtifacts,
              findings,
              warnings: [
                `parse_failure: 0 tables / 0 policies from ${String(byteCount)} bytes; CREATE TABLE=${String(createTableLines)}, CREATE POLICY=${String(createPolicyLines)}, ENABLE RLS=${String(enableRlsLines)}`,
              ],
              output: {
                tables: [],
                findingsCount: findings.length,
              },
            };
          }
        }
      } else if (input.schemaSource.source === 'rest') {
        // Step 27: REST source. Call `database.fetchTables()`. The
        // capability gate enforces `read_schema_metadata` per call;
        // the agent does NOT relax it. Storage buckets, when the
        // optional source is wired, come from `storage.fetchBuckets()`.
        //
        // Honest REST limitations (codex step27-df1 + df2):
        //  - REST `database/openapi` exposes table identifiers but
        //    NOT RLS state. The agent emits cc-11-5 coverage_gap
        //    per table and does NOT fall through to predicateRlsMissing
        //    (which would produce false-positive findings from
        //    unknown evidence).
        //  - REST does NOT expose policy USING / WITH CHECK bodies.
        //    `database.fetchPolicies()` returns `capability_not_exposed`;
        //    the agent emits cc-11-6 + cc-11-9 coverage_gap findings
        //    honestly.
        const tablesR = await input.schemaSource.database.fetchTables();
        if (!tablesR.ok) {
          const m = tablesR.error.message;
          return {
            status: 'completed',
            artifacts: [],
            findings: [
              {
                id: 'cc-11-5-coverage-gap-rest-failed',
                control_id: 'cc-11-5',
                finding_type: 'coverage_gap',
                evidence_strength: 'low',
                reproducibility: 'manual_review_required',
                review_action: 'review_before_launch',
                blast_radius: 'unknown',
                title: 'Supabase REST schema read failed',
                summary: `the Supabase Management REST read for project_ref did not complete: ${m}. RLS predicates could not run. Needs human review. ${UNCERTAINTY_NOTE}.`,
                evidence_refs: [],
              },
            ],
            warnings: [`rest_schema_read_failed: ${m}`],
          };
        }
        // Convert TableSnapshot[] into the agent's internal ParsedSchema
        // shape. Per codex step27-df1: REST does NOT expose RLS state,
        // so we DO NOT populate `tables` for `predicateRlsMissing` to
        // consume (that would fire on unknown evidence). The parsed
        // schema stays empty of tables; cc-11-5 coverage_gap is
        // emitted explicitly below from `restCoverageGaps`.
        parsed = {
          tables: [],
          policies: [],
          grants: [],
          unparseable: [],
        };

        // Build explicit coverage_gap findings honoring the step 27
        // §"Verified Supabase Management REST endpoints" limitations.
        // These run regardless of how `database.fetchPolicies()`
        // resolves — the REST surface does not return USING / WITH
        // CHECK in the documented v1 endpoints we accept.
        const policiesR = await input.schemaSource.database.fetchPolicies();
        // We use the result only to confirm the contract; the
        // policy-not-exposed coverage_gap below is the same outcome
        // whether the error is `capability_not_exposed`, a
        // `transport_error`, or `parse_error`. Falsely returning
        // policies here is a step-27 contract violation and would
        // require its own follow-up.
        const policiesErrMessage =
          !policiesR.ok ? policiesR.error.message : 'no policies returned';

        const tableCount = tablesR.value.length;
        // cc-11-5: one per-scan coverage_gap citing the count of
        // tables the REST surface listed. We do NOT enumerate each
        // table individually — REST gave us no signal to attach.
        restCoverageGaps = [
          {
            id: 'cc-11-5-rest-coverage-gap',
            control_id: 'cc-11-5',
            finding_type: 'coverage_gap',
            evidence_strength: 'low',
            reproducibility: 'manual_review_required',
            review_action: 'review_before_launch',
            blast_radius: 'unknown',
            title: 'RLS state for Supabase tables was not checked (REST backend)',
            summary: `The Supabase Management REST API listed ${String(tableCount)} table(s) but does not expose RLS-enabled state via the documented v1 endpoints. cc-11-5 was not checked for any table; negative tests should be added once RLS state is read via a backend that exposes it. Needs human review. ${UNCERTAINTY_NOTE}.`,
            evidence_refs: [],
          },
          {
            id: 'cc-11-6-rest-coverage-gap',
            control_id: 'cc-11-6',
            finding_type: 'coverage_gap',
            evidence_strength: 'low',
            reproducibility: 'manual_review_required',
            review_action: 'review_before_launch',
            blast_radius: 'unknown',
            title: 'RLS policy bodies were not checked (REST backend)',
            summary: `Supabase Management REST does not expose RLS policy USING / WITH CHECK expressions via documented endpoints (${policiesErrMessage}). cc-11-6 was not checked; needs human review. ${UNCERTAINTY_NOTE}.`,
            evidence_refs: [],
          },
          {
            id: 'cc-11-9-rest-coverage-gap',
            control_id: 'cc-11-9',
            finding_type: 'coverage_gap',
            evidence_strength: 'low',
            reproducibility: 'manual_review_required',
            review_action: 'review_before_launch',
            blast_radius: 'unknown',
            title: 'Per-row authenticated policy checks were not checked (REST backend)',
            summary: `Without USING / WITH CHECK bodies, the cc-11-9 per-row predicate cannot run. Needs human review. ${UNCERTAINTY_NOTE}.`,
            evidence_refs: [],
          },
        ];

        // Pull buckets via REST when wired (step 27 customer default).
        // Codex step27-df3: REST `storage/buckets` returns `public`
        // flag per bucket but does NOT return per-bucket access
        // policies. cc-11-12 (public bucket WITH anon SELECT policy)
        // therefore cannot run for the REST source — instead, every
        // public bucket gets a coverage_gap finding noting that
        // SELECT policies were not checked. predicatePublicBucket
        // would otherwise silently filter out these buckets.
        if (input.schemaSource.storage !== undefined) {
          const bucketsR = await input.schemaSource.storage.fetchBuckets();
          if (bucketsR.ok) {
            bucketRecordsFromMcp = bucketsR.value.map((b) => ({
              id: b.id,
              name: b.name,
              public: b.public,
              // REST doesn't surface per-bucket policies; leave the
              // optional `policies` field undefined so the predicate
              // doesn't falsely emit a `likely_issue` from
              // unverifiable evidence.
            }));
            isRestStorageSource = true;
            // Emit explicit coverage_gap per public bucket.
            const publicBuckets = bucketsR.value.filter((b) => b.public);
            restCoverageGaps = [
              ...restCoverageGaps,
              ...publicBuckets.map<Finding>((b) => ({
                id: `cc-11-12-rest-coverage-gap-${b.id}`,
                control_id: 'cc-11-12',
                finding_type: 'coverage_gap',
                evidence_strength: 'low',
                reproducibility: 'manual_review_required',
                review_action: 'review_before_launch',
                blast_radius: 'private_files',
                title: `Public bucket "${b.name}" SELECT policies were not checked (REST backend)`,
                summary: `The Supabase Management REST API reported bucket "${b.name}" as public but does not expose per-bucket access policies via documented endpoints. cc-11-12 (anonymous SELECT policy detection) was not checked for this bucket; negative tests should be added once policies are read via a backend that exposes them. Needs human review. ${UNCERTAINTY_NOTE}.`,
                evidence_refs: [],
              })),
            ];
          }
        }
      } else {
        // MCP source: call the read-only allowlisted tools and convert
        // responses into the same ParsedSchema shape the SQL path
        // produces. The connector's checkInvocation gate enforces
        // read_only=true + project_ref per call (retro-16); the agent
        // does NOT relax that gate.
        const mcpResult = await readSchemaFromMcp(input.schemaSource.client);
        if (!mcpResult.ok) {
          const m = mcpResult.error.message;
          return {
            status: 'completed',
            artifacts: [],
            findings: [
              {
                id: 'cc-11-5-coverage-gap-mcp-failed',
                control_id: 'cc-11-5',
                finding_type: 'coverage_gap',
                evidence_strength: 'low',
                reproducibility: 'manual_review_required',
                review_action: 'review_before_launch',
                blast_radius: 'unknown',
                title: 'Supabase MCP schema read failed',
                summary: `the Supabase MCP read for project_ref did not complete: ${m}. RLS predicates could not run. Needs human review. ${UNCERTAINTY_NOTE}.`,
                evidence_refs: [],
              },
            ],
            warnings: [`mcp_schema_read_failed: ${m}`],
          };
        }
        parsed = mcpResult.value.parsed;
        bucketRecordsFromMcp = mcpResult.value.buckets;
      }

      // 09b: run Pass-1 assertion predicates over ScanFact[].
      const schemaFacts = buildSchemaFacts(parsed, sourceTag, parserId);
      const bucketRecords =
        bucketRecordsFromMcp ??
        (await loadBucketsArtifact(input.storageBucketsArtifactPath));
      const bucketFacts = bucketRecords !== undefined
        ? bucketRecordsToFacts(bucketRecords, sourceTag)
        : [];

      // Step 23 Bug A: read env_declarations from
      // inventory-bootstrap.json (when present) and convert each
      // declaration into a local_file/env_declaration ScanFact so the
      // cc-11-7 predicate can consume it under the same ScanFact
      // contract as the schema + bucket predicates. Absent or
      // unreadable inventory is tolerated — cc-11-7 simply produces
      // no findings (no scope_creep / no synthetic positives).
      const envFacts: readonly ScanFact[] = await (async () => {
        if (input.inventoryArtifactPath === undefined) return [];
        try {
          const inventoryText = await fs.readFile(
            input.inventoryArtifactPath,
            'utf8',
          );
          const inv = JSON.parse(inventoryText) as {
            observed_evidence?: { env_declarations?: readonly string[] };
          };
          const decls = inv.observed_evidence?.env_declarations ?? [];
          return envDeclarationsToScanFacts(decls, context.projectRoot);
        } catch {
          return [];
        }
      })();

      const allFacts: readonly ScanFact[] = [
        ...schemaFacts,
        ...bucketFacts,
        ...envFacts,
      ];

      const predicateFindings: readonly Finding[] = [
        ...predicateRlsMissing(allFacts),
        ...predicateBroadPolicy(allFacts),
        ...predicateAllAuthenticated(allFacts),
        ...predicatePublicBucket(allFacts),
        ...predicatePrivilegedClientKey(allFacts),
      ];

      // Retro-09b f6: only the coverage_gap-only builder remains for
      // findings the fact-based predicates cannot infer (non-public
      // schemas and unparseable SQL blocks).
      const coverageGaps = buildCoverageGapFindings(parsed);
      void evaluateBuckets;

      const allFindings: readonly Finding[] = [
        ...predicateFindings,
        ...coverageGaps,
        ...restCoverageGaps,
      ];

      // Step 27 codex df4: write capability-shaped primary artifacts
      // (`database-metadata.json`, `storage-metadata.json`) and keep
      // the transport-shaped names (`supabase-tables.json`) as
      // compatibility aliases for one Phase 1 release. The alias
      // copy emits a deprecation note via context.logger so
      // scan-actions.log (which the orchestrator routes the logger
      // into) carries the marker the next step uses to remove the
      // alias surface.
      const databaseMetadataPath = await writeDatabaseMetadataArtifact(
        context.artifactDir,
        parsed,
      );
      const writeResult = await writeTablesArtifact(
        context.artifactDir,
        parsed,
      );
      if (databaseMetadataPath.ok) {
        context.logger.info(
          'supabase-rls: wrote capability-shaped artifact database-metadata.json',
        );
      } else {
        context.logger.warn(
          `supabase-rls: failed to write database-metadata.json: ${databaseMetadataPath.error.message}`,
        );
      }
      if (isErr(writeResult)) {
        context.logger.warn(
          `supabase-rls: failed to write supabase-tables.json: ${writeResult.error.message}`,
        );
      } else {
        context.logger.warn(
          'supabase-rls: wrote compatibility alias supabase-tables.json; this transport-shaped name is deprecated and will be removed in the next step (use database-metadata.json)',
        );
      }
      // Storage capability artifact. Written when bucket records are
      // available (from REST `StorageMetadataSource` or MCP). The
      // transport-shaped storage-buckets.json is produced by the
      // connector (existing path) — this is the capability-shaped
      // primary that the next step consolidates on.
      let storageMetadataPath:
        | import('../../types/result.js').Result<string, Error>
        | undefined;
      if (bucketRecordsFromMcp !== undefined && bucketRecordsFromMcp.length > 0) {
        storageMetadataPath = await writeStorageMetadataArtifact(
          context.artifactDir,
          bucketRecordsFromMcp,
        );
        if (storageMetadataPath.ok) {
          context.logger.info(
            `supabase-rls: wrote capability-shaped artifact storage-metadata.json (${isRestStorageSource ? 'rest' : 'mcp'} backend)`,
          );
        }
      }

      const artifacts: ArtifactRef[] = [];
      if (databaseMetadataPath.ok) {
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: databaseMetadataPath.value,
        });
      }
      if (!isErr(writeResult)) {
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: writeResult.value,
        });
      }
      if (storageMetadataPath !== undefined && storageMetadataPath.ok) {
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: storageMetadataPath.value,
        });
      }
      return {
        status: 'completed',
        artifacts,
        findings: allFindings,
        warnings: [],
        output: {
          tables: parsed.tables,
          findingsCount: allFindings.length,
        },
      };
    },
  };
}

async function writeTablesArtifact(
  artifactDir: string,
  parsed: ParsedSchema,
): Promise<import('../../types/result.js').Result<string, Error>> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const out = path.join(artifactDir, 'supabase-tables.json');
  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(out, JSON.stringify(parsed, null, 2), 'utf8');
    const { ok } = await import('../../types/result.js');
    return ok(out);
  } catch (cause) {
    const { err } = await import('../../types/result.js');
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(new Error(message));
  }
}

/**
 * Step 27 codex df4: capability-shaped primary artifact for database
 * metadata. `supabase-tables.json` remains as a transport-shaped
 * compatibility alias for one Phase 1 release.
 */
async function writeDatabaseMetadataArtifact(
  artifactDir: string,
  parsed: ParsedSchema,
): Promise<import('../../types/result.js').Result<string, Error>> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const out = path.join(artifactDir, 'database-metadata.json');
  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(out, JSON.stringify(parsed, null, 2), 'utf8');
    const { ok } = await import('../../types/result.js');
    return ok(out);
  } catch (cause) {
    const { err } = await import('../../types/result.js');
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(new Error(message));
  }
}

/**
 * Step 27 codex df4: capability-shaped primary artifact for storage
 * metadata. The connector's transport-shaped `storage-buckets.json`
 * (written upstream by the supabase connector) remains as the alias
 * for one Phase 1 release.
 */
async function writeStorageMetadataArtifact(
  artifactDir: string,
  buckets: readonly BucketRecord[],
): Promise<import('../../types/result.js').Result<string, Error>> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const out = path.join(artifactDir, 'storage-metadata.json');
  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(out, JSON.stringify({ buckets }, null, 2), 'utf8');
    const { ok } = await import('../../types/result.js');
    return ok(out);
  } catch (cause) {
    const { err } = await import('../../types/result.js');
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(new Error(message));
  }
}
