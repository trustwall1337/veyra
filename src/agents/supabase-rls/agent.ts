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
import { classifyTable } from './heuristics.js';
import { parseSchemaSql } from './parser.js';
import {
  predicateAllAuthenticated,
  predicateBroadPolicy,
  predicatePublicBucket,
  predicateRlsMissing,
} from './predicates.js';
import { buildSchemaFacts } from './schema-facts.js';
import type {
  ParsedPolicy,
  ParsedSchema,
  SupabaseRlsInput,
  SupabaseRlsOutput,
} from './types.js';

const METADATA: AgentMetadata = {
  id: 'supabase-rls',
  version: '0.1.0',
  declared_dependencies: ['supabase-schema-sql', 'storage-buckets-json'],
};

const UNCERTAINTY_NOTE =
  'regex parser; complex SQL may be missed (CTEs, DO $$ blocks, multi-statement policies, user-defined functions)';

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

function fingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function looksOpenUsing(expr: string | undefined): boolean {
  if (expr === undefined) return false;
  const normalized = expr.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized === 'true';
}

function policiesForTable(
  schema: ParsedSchema,
  schemaName: string,
  tableName: string,
): readonly ParsedPolicy[] {
  return schema.policies.filter(
    (p) => p.schema === schemaName && p.table === tableName,
  );
}

function buildFindings(
  schema: ParsedSchema,
  schemaSqlPath: string,
): readonly Finding[] {
  const findings: Finding[] = [];

  // Non-public schemas (Phase 1 limit): emit coverage_gap so they are
  // never silently skipped. The parser may still produce table records
  // for them; we record each as a manual-review item before the main
  // loop below ignores them.
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

  for (const table of schema.tables) {
    if (table.schema !== 'public') continue;
    const sensitivity = classifyTable(table.name);
    // Evidence references are empty in step 09 — the assertion-predicate
    // reshape in 09b will reference ScanFact.fact_id values (per revision
    // §3.3 evidence_refs is fact-only).
    const _refId = `supabase-schema:${schemaSqlPath}:${table.schema}.${table.name}:${fingerprint(JSON.stringify(table.source_range))}`;
    void _refId;
    const policies = policiesForTable(schema, table.schema, table.name);

    // cc-11-5 and cc-11-6 require sensitivity (name-driven).
    if (sensitivity.matched_via !== 'none') {
      // cc-11-5 — sensitive table without ENABLE ROW LEVEL SECURITY.
      if (!table.rls_enabled) {
        findings.push({
          id: `cc-11-5-${table.schema}.${table.name}`,
          control_id: 'cc-11-5',
          finding_type: 'likely_issue',
          evidence_strength: sensitivity.strength,
          reproducibility: 'static',
          review_action: 'fix_before_launch',
          blast_radius:
            table.name === 'users' || table.name === 'accounts'
              ? 'user_data'
              : 'tenant_data',
          title: `RLS appears missing on sensitive table "${table.schema}.${table.name}"`,
          summary: `Table "${table.schema}.${table.name}" was identified as sensitive (${sensitivity.matched_via}${sensitivity.pattern_label !== undefined ? ` "${sensitivity.pattern_label}"` : ''}) but no ENABLE ROW LEVEL SECURITY statement was found. This appears launch-blocking; needs human review. ${UNCERTAINTY_NOTE}.`,
          evidence_refs: [],
        });
      }

      // cc-11-6 — CREATE POLICY … USING (true) on sensitive table.
      for (const p of policies) {
        if (looksOpenUsing(p.using_expr)) {
          findings.push({
            id: `cc-11-6-${table.schema}.${table.name}-${p.name}`,
            control_id: 'cc-11-6',
            finding_type: 'likely_issue',
            evidence_strength: sensitivity.strength,
            reproducibility: 'static',
            review_action: 'fix_before_launch',
            blast_radius:
              table.name === 'users' || table.name === 'accounts'
                ? 'user_data'
                : 'tenant_data',
            title: `Open policy "USING (true)" on sensitive table "${table.schema}.${table.name}"`,
            summary: `Policy "${p.name}" on "${table.schema}.${table.name}" uses USING (true) — every row is visible regardless of identity. This appears launch-blocking; needs human review. ${UNCERTAINTY_NOTE}.`,
            evidence_refs: [],
          });
        }
      }
    }

    // cc-11-9 — CREATE POLICY ... TO authenticated USING (...) without a
    // per-row check. The policy is structurally problematic regardless of
    // table sensitivity. Strength is `high` on canonical-name tables,
    // otherwise `medium`.
    for (const p of policies) {
      if (p.role === undefined) continue;
      const roles = p.role.split(',').map((s) => s.trim().toLowerCase());
      if (!roles.includes('authenticated')) continue;
      const expr = (p.using_expr ?? '').toLowerCase();
      const hasPerRow =
        expr.includes('auth.') ||
        expr.includes('current_setting') ||
        (expr.includes('=') && expr.length > 4 && expr !== 'true');
      if (!hasPerRow) {
        findings.push({
          id: `cc-11-9-${table.schema}.${table.name}-${p.name}`,
          control_id: 'cc-11-9',
          finding_type: 'likely_issue',
          evidence_strength:
            sensitivity.matched_via === 'exact_name' ? 'high' : 'medium',
          reproducibility: 'static',
          review_action: 'fix_before_launch',
          blast_radius: 'tenant_data',
          title: `Policy grants ${p.operation} on "${table.schema}.${table.name}" to authenticated without a per-row check`,
          summary: `Policy "${p.name}" allows the authenticated role ${p.operation} on "${table.schema}.${table.name}", but the USING expression does not appear to constrain rows by identity (no auth.uid / current_setting / equality check). Any signed-in user appears to read the full table. Needs human review. ${UNCERTAINTY_NOTE}.`,
          evidence_refs: [],
        });
      }
    }
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
      let sql: string;
      try {
        sql = await fs.readFile(input.schemaSqlPath, 'utf8');
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        context.logger.warn(`supabase-rls: cannot read schema ${input.schemaSqlPath}: ${m}`);
        return {
          status: 'failed',
          artifacts: [],
          findings: [],
          warnings: [`schema_read_failed: ${m}`],
        };
      }

      let parsed: ParsedSchema;
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

      // 09b: run Pass-1 assertion predicates over ScanFact[].
      const schemaFacts = buildSchemaFacts(parsed, input.schemaSqlPath);
      const bucketRecords = await loadBucketsArtifact(
        input.storageBucketsArtifactPath,
      );
      const bucketFacts = bucketRecords !== undefined
        ? bucketRecordsToFacts(bucketRecords, input.schemaSqlPath)
        : [];
      const allFacts: readonly ScanFact[] = [...schemaFacts, ...bucketFacts];

      const predicateFindings: readonly Finding[] = [
        ...predicateRlsMissing(allFacts),
        ...predicateBroadPolicy(allFacts),
        ...predicateAllAuthenticated(allFacts),
        ...predicatePublicBucket(allFacts),
      ];

      // Pre-09b path retained for the unparseable / non-public-schema
      // coverage_gap findings the predicate set does not produce.
      const schemaFindings = buildFindings(parsed, input.schemaSqlPath);
      const unparseableAndNonPublic = schemaFindings.filter(
        (f) => f.finding_type === 'coverage_gap',
      );
      // Also keep the (pre-09b) bucket evaluator only when MCP buckets
      // are absent — the predicate already covers coverage_gap and the
      // present case. Dedupe by control_id + bucket name.
      void evaluateBuckets;

      const allFindings: readonly Finding[] = [
        ...predicateFindings,
        ...unparseableAndNonPublic,
      ];

      const writeResult = await writeTablesArtifact(
        context.artifactDir,
        parsed,
      );
      if (isErr(writeResult)) {
        context.logger.warn(
          `supabase-rls: failed to write supabase-tables.json: ${writeResult.error.message}`,
        );
      }

      const artifacts: ArtifactRef[] = [];
      if (!isErr(writeResult)) {
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: writeResult.value,
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
