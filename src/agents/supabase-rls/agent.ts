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
import { parseSchemaSql } from './parser.js';
import {
  predicateAllAuthenticated,
  predicateBroadPolicy,
  predicatePublicBucket,
  predicateRlsMissing,
} from './predicates.js';
import { buildSchemaFacts } from './schema-facts.js';
import type {
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
      let sql: string;
      try {
        sql = await fs.readFile(input.schemaSqlPath, 'utf8');
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        context.logger.warn(`supabase-rls: cannot read schema ${input.schemaSqlPath}: ${m}`);
        // Retro-09b f8: missing schema input is an observable coverage
        // gap, not an agent failure. The scan continues; the report
        // shows the gap to the reviewer.
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
              summary: `schema input at ${input.schemaSqlPath} could not be read: ${m}. RLS predicates could not run. Negative tests should be added once the schema is available. ${UNCERTAINTY_NOTE}.`,
              evidence_refs: [],
            },
          ],
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

      // Retro-09b f6: only the coverage_gap-only builder remains for
      // findings the fact-based predicates cannot infer (non-public
      // schemas and unparseable SQL blocks).
      const coverageGaps = buildCoverageGapFindings(parsed);
      void evaluateBuckets;

      const allFindings: readonly Finding[] = [
        ...predicateFindings,
        ...coverageGaps,
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
