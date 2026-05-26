/**
 * Convert deterministic schema parser output into `ScanFact[]` records.
 *
 * Per revision §10 step 09 row + §3.1: the supabase-rls agent's Pass-1
 * predicates consume ScanFact[], not raw parser output. This module is
 * the bridge: parser.ts → schema-element facts. Adding new schema
 * observations (column metadata, FK constraints) = new entries here;
 * predicates that consume them = new files in `predicates/`.
 */

import { createHash } from 'node:crypto';

import { asParserId, type ParserId } from '../../types/identity.js';
import type {
  ScanFact,
  ScanFactPayload,
  SchemaElementSource,
} from '../../types/scan-fact.js';

import type { ParsedPolicy, ParsedSchema, ParsedTable } from './types.js';

function mintParserId(name: string): ParserId {
  const r = asParserId(name);
  if (!r.ok) throw new Error(`bug: ${r.error.message}`);
  return r.value;
}

export const SUPABASE_SCHEMA_PARSER_ID: ParserId = mintParserId('supabase-schema');
// Step 24: distinct ParserId for MCP-sourced schema facts. The same
// schema-element fact shape; only the provenance changes. Consumers
// (predicates, tests) can read `source.parser_id` to learn whether
// the observation came from a local SQL dump or a live MCP call.
export const SUPABASE_MCP_PARSER_ID: ParserId = mintParserId('supabase-mcp');

function parserIdFor(name: string): ParserId {
  return name === 'supabase-mcp'
    ? SUPABASE_MCP_PARSER_ID
    : SUPABASE_SCHEMA_PARSER_ID;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function factForTable(
  table: ParsedTable,
  schemaPath: string,
  parserId: ParserId,
): ScanFact {
  const source: SchemaElementSource = {
    kind: 'schema_element',
    parser_id: parserId,
    element_kind: 'table',
    name: `${table.schema}.${table.name}`,
  };
  const payload: ScanFactPayload = {
    sanitized_excerpt: JSON.stringify({
      schema: table.schema,
      name: table.name,
      rls_enabled: table.rls_enabled,
      source_range: table.source_range,
    }),
    content_kind: 'json',
  };
  return {
    fact_id: sha256(`table:${schemaPath}:${table.schema}.${table.name}`),
    source: { ...source, payload },
    file_path: schemaPath,
    line: table.source_range.start,
    observed_at: new Date().toISOString(),
    args_fingerprint_sha256: sha256(schemaPath),
    redacted: false,
  };
}

function factForPolicy(
  policy: ParsedPolicy,
  schemaPath: string,
  parserId: ParserId,
): ScanFact {
  const source: SchemaElementSource = {
    kind: 'schema_element',
    parser_id: parserId,
    element_kind: 'policy',
    name: `${policy.schema}.${policy.table}:${policy.name}`,
  };
  const payload: ScanFactPayload = {
    sanitized_excerpt: JSON.stringify({
      name: policy.name,
      schema: policy.schema,
      table: policy.table,
      operation: policy.operation,
      role: policy.role,
      using_expr: policy.using_expr,
      with_check_expr: policy.with_check_expr,
    }),
    content_kind: 'json',
  };
  return {
    fact_id: sha256(
      `policy:${schemaPath}:${policy.schema}.${policy.table}:${policy.name}`,
    ),
    source: { ...source, payload },
    file_path: schemaPath,
    line: policy.source_range.start,
    observed_at: new Date().toISOString(),
    args_fingerprint_sha256: sha256(schemaPath),
    redacted: false,
  };
}

export function buildSchemaFacts(
  parsed: ParsedSchema,
  schemaPath: string,
  parserName: string = 'supabase-schema',
): readonly ScanFact[] {
  const parserId = parserIdFor(parserName);
  const facts: ScanFact[] = [];
  for (const t of parsed.tables) facts.push(factForTable(t, schemaPath, parserId));
  for (const p of parsed.policies) facts.push(factForPolicy(p, schemaPath, parserId));
  return facts;
}
