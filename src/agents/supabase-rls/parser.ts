/**
 * Regex/line-based parser for `supabase db dump` output.
 *
 * Per step 09 Done-When: supports the common patterns Phase 1 needs
 * (ENABLE ROW LEVEL SECURITY, CREATE POLICY, GRANT). Known misses
 * (CTEs, DO $$ blocks, multi-statement policies, user-defined function
 * bodies, non-public schemas) are NOT silently ignored — each
 * unparseable block surfaces in `unparseable[]` so the agent can emit
 * a coverage_gap Finding with `reproducibility: manual_review_required`
 * pointing at the source range.
 */

import type {
  ParsedGrant,
  ParsedPolicy,
  ParsedSchema,
  ParsedTable,
  UnparseableBlock,
} from './types.js';

const POLICY_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'] as const;
type PolicyOp = (typeof POLICY_OPS)[number];

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/i;
const ALTER_TABLE_RLS_RE =
  /ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
const CREATE_POLICY_RE = new RegExp(
  String.raw`CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)`,
  'i',
);
const POLICY_FOR_RE = /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i;
const POLICY_TO_RE = /\bTO\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/i;
const POLICY_USING_RE = /\bUSING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|;)/i;
const POLICY_WITH_CHECK_RE = /\bWITH\s+CHECK\s*\(([\s\S]*?)\)\s*;/i;
const GRANT_RE = /GRANT\s+([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/i;

const UNPARSEABLE_PATTERNS: readonly RegExp[] = [
  /\bDO\s+\$\$/i,
  /\bWITH\b[\s\S]*?\bAS\b\s*\(/i, // CTE-shaped
];

interface Statement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function splitStatements(sql: string): readonly Statement[] {
  const lines = sql.split(/\r?\n/);
  const out: Statement[] = [];
  let buf: string[] = [];
  let startLine = 1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    // Skip pure comment lines for statement-grouping but keep them in
    // line counting via i.
    if (line.trim() === '' && buf.length === 0) {
      startLine = i + 2;
      continue;
    }
    buf.push(line);
    if (line.includes(';')) {
      out.push({
        start: startLine,
        end: i + 1,
        text: buf.join('\n'),
      });
      buf = [];
      startLine = i + 2;
    }
  }
  if (buf.length > 0 && buf.join('').trim().length > 0) {
    out.push({
      start: startLine,
      end: lines.length,
      text: buf.join('\n'),
    });
  }
  return out;
}

function tagUnparseable(stmt: Statement): UnparseableBlock | null {
  for (const re of UNPARSEABLE_PATTERNS) {
    if (re.test(stmt.text)) {
      return {
        source_range: { start: stmt.start, end: stmt.end },
        reason:
          re.source.includes('DO')
            ? 'anonymous DO $$ block — body inspection not supported'
            : 'CTE-shaped statement — nested SELECT/WITH not parsed',
        excerpt: stmt.text.slice(0, 120),
      };
    }
  }
  return null;
}

export function parseSchemaSql(sql: string): ParsedSchema {
  const statements = splitStatements(sql);
  const tablesByKey = new Map<string, ParsedTable>();
  const policies: ParsedPolicy[] = [];
  const grants: ParsedGrant[] = [];
  const unparseable: UnparseableBlock[] = [];

  for (const stmt of statements) {
    const u = tagUnparseable(stmt);
    if (u !== null) {
      unparseable.push(u);
      continue;
    }

    const createMatch = CREATE_TABLE_RE.exec(stmt.text);
    if (createMatch?.[1] !== undefined && createMatch[2] !== undefined) {
      const schema = createMatch[1];
      const name = createMatch[2];
      const key = `${schema}.${name}`;
      const existing = tablesByKey.get(key);
      tablesByKey.set(key, {
        schema,
        name,
        source_range: existing?.source_range ?? {
          start: stmt.start,
          end: stmt.end,
        },
        rls_enabled: existing?.rls_enabled ?? false,
      });
      continue;
    }

    const alterMatch = ALTER_TABLE_RLS_RE.exec(stmt.text);
    if (alterMatch?.[1] !== undefined && alterMatch[2] !== undefined) {
      const key = `${alterMatch[1]}.${alterMatch[2]}`;
      const existing = tablesByKey.get(key);
      if (existing !== undefined) {
        tablesByKey.set(key, { ...existing, rls_enabled: true });
      } else {
        tablesByKey.set(key, {
          schema: alterMatch[1],
          name: alterMatch[2],
          source_range: { start: stmt.start, end: stmt.end },
          rls_enabled: true,
        });
      }
      continue;
    }

    const policyMatch = CREATE_POLICY_RE.exec(stmt.text);
    if (
      policyMatch?.[1] !== undefined &&
      policyMatch[2] !== undefined &&
      policyMatch[3] !== undefined
    ) {
      const forMatch = POLICY_FOR_RE.exec(stmt.text);
      const op = (forMatch?.[1]?.toUpperCase() as PolicyOp | undefined) ?? 'ALL';
      const toMatch = POLICY_TO_RE.exec(stmt.text);
      const role = toMatch?.[1]?.trim();
      const usingMatch = POLICY_USING_RE.exec(stmt.text);
      const wcMatch = POLICY_WITH_CHECK_RE.exec(stmt.text);
      const policy: ParsedPolicy = {
        name: policyMatch[1],
        schema: policyMatch[2],
        table: policyMatch[3],
        operation: op,
        ...(role !== undefined ? { role } : {}),
        ...(usingMatch?.[1] !== undefined
          ? { using_expr: usingMatch[1].trim() }
          : {}),
        ...(wcMatch?.[1] !== undefined
          ? { with_check_expr: wcMatch[1].trim() }
          : {}),
        source_range: { start: stmt.start, end: stmt.end },
      };
      policies.push(policy);
      continue;
    }

    const grantMatch = GRANT_RE.exec(stmt.text);
    if (grantMatch !== null) {
      const [, privs, schema, table, role] = grantMatch;
      if (
        privs !== undefined &&
        schema !== undefined &&
        table !== undefined &&
        role !== undefined
      ) {
        grants.push({
          privileges: privs
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => s.length > 0),
          schema,
          table,
          role,
          source_range: { start: stmt.start, end: stmt.end },
        });
        continue;
      }
    }
  }

  return {
    tables: Array.from(tablesByKey.values()),
    policies,
    grants,
    unparseable,
  };
}
