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

// Step 26 Piece 1: support the syntax Supabase's `supabase db dump
// --linked` actually emits — quoted, schema-qualified identifiers
// (`"public"."users"`) and `IF NOT EXISTS` clauses. Identifier match
// is `("..."|name)` and accepts either schema."table" or schema.table.
//
// IDENT matches:
//   - `"public"`        → public  (captured without quotes)
//   - `public`          → public
//   - `"public name"`   → public name (handles names with spaces)
const IDENT = String.raw`(?:"([^"]+)"|([a-z_][a-z0-9_]*))`;
// Helper: each occurrence of IDENT in a pattern produces 2 capture
// groups — the quoted form and the bare form. The caller picks
// whichever is defined via `pickIdent`.
function pickIdent(quoted: string | undefined, bare: string | undefined): string | undefined {
  return quoted ?? bare;
}

const CREATE_TABLE_RE = new RegExp(
  String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\.${IDENT}`,
  'i',
);
const ALTER_TABLE_RLS_RE = new RegExp(
  String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDENT}\.${IDENT}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
  'i',
);
const CREATE_POLICY_RE = new RegExp(
  String.raw`CREATE\s+POLICY\s+${IDENT}\s+ON\s+${IDENT}\.${IDENT}`,
  'i',
);
const POLICY_FOR_RE = /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i;
const POLICY_TO_RE = /\bTO\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/i;
const POLICY_USING_RE = /\bUSING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|;|$)/i;
const POLICY_WITH_CHECK_RE = /\bWITH\s+CHECK\s*\(([\s\S]*?)\)\s*;/i;
const GRANT_RE = new RegExp(
  String.raw`GRANT\s+([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?${IDENT}\.${IDENT}\s+TO\s+${IDENT}`,
  'i',
);

// Step 26 Piece 1: deliberately-skipped pg_dump preamble. These are
// not parser failures — they're known-irrelevant-to-Phase-1 statements
// that real Supabase dumps include. Without this skip list every
// `SET statement_timeout = 0` would either pollute `unparseable[]` or
// be matched (incorrectly) by a downstream regex.
const SKIP_STATEMENT_PATTERNS: readonly RegExp[] = [
  /^\s*SET\s+/i, // SET statement_timeout = 0, SET search_path, ...
  /^\s*SELECT\s+pg_catalog\.set_config/i,
  /^\s*COMMENT\s+ON\s+/i,
  /^\s*ALTER\s+\w+\s+.*\s+OWNER\s+TO\s+/i, // ALTER TABLE ... OWNER TO postgres
  /^\s*CREATE\s+TYPE\s+/i, // CREATE TYPE ... AS ENUM (...)
  /^\s*CREATE\s+OR\s+REPLACE\s+FUNCTION\s+/i,
  /^\s*CREATE\s+FUNCTION\s+/i,
  /^\s*CREATE\s+EXTENSION\s+/i,
  /^\s*CREATE\s+SCHEMA\s+/i, // CREATE SCHEMA IF NOT EXISTS "public" — informational
  /^\s*CREATE\s+SEQUENCE\s+/i,
  /^\s*CREATE\s+INDEX\s+/i,
  /^\s*CREATE\s+UNIQUE\s+INDEX\s+/i,
  /^\s*CREATE\s+TRIGGER\s+/i,
  /^\s*CREATE\s+VIEW\s+/i,
  /^\s*CREATE\s+MATERIALIZED\s+VIEW\s+/i,
  /^\s*ALTER\s+SEQUENCE\s+/i,
  /^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+/i,
  /^\s*REVOKE\s+/i,
  /^\s*INSERT\s+INTO\s+/i, // data inserts in dumps; not schema
  /^\s*COPY\s+/i,
  /^\s*\\/, // psql meta-commands like \connect
];

/**
 * Strip leading SQL comment lines (`-- ...`) from a statement's text
 * so the skip-pattern matcher sees the first non-comment line. The
 * statement-splitter accumulates everything between semicolons, so a
 * `CREATE TABLE` preceded by `-- explanatory comment` lines has those
 * comments in `text`. Without stripping, every commented statement
 * would look like it starts with `--` and trip a too-aggressive
 * "skip comments" pattern that swallows the whole statement.
 */
function stripLeadingComments(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (
    i < lines.length &&
    (lines[i]?.trim() === '' || lines[i]?.trim().startsWith('--'))
  ) {
    i += 1;
  }
  return lines.slice(i).join('\n');
}

function isSkippableStatement(text: string): boolean {
  const stripped = stripLeadingComments(text).trim();
  if (stripped.length === 0) return true;
  return SKIP_STATEMENT_PATTERNS.some((re) => re.test(stripped));
}

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
      // Step 26 retro-f3: do NOT include raw dump excerpts here. Real
      // pg_dump function bodies and DO $$ blocks can contain secrets
      // (CHECK constraints with literal values, embedded JWT defaults,
      // pgcrypto fixtures). supabase-tables.json persists this whole
      // ParsedSchema, so any raw excerpt would land in an artifact —
      // a violation of CLAUDE.md §Secrets. Cite line range + byte
      // range only; the operator can open the dump themselves at
      // those coordinates.
      const byteCount = Buffer.byteLength(stmt.text, 'utf8');
      return {
        source_range: { start: stmt.start, end: stmt.end },
        reason:
          re.source.includes('DO')
            ? 'anonymous DO $$ block — body inspection not supported'
            : 'CTE-shaped statement — nested SELECT/WITH not parsed',
        excerpt: `<redacted; ${String(byteCount)} bytes at lines ${String(stmt.start)}-${String(stmt.end)}>`,
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
    // Step 26: skip known-irrelevant pg_dump preamble first. These
    // are not parser failures; they're statements Phase 1 doesn't
    // care about. Without the skip-list every `SET` line either
    // pollutes `unparseable[]` or is mistakenly matched downstream.
    if (isSkippableStatement(stmt.text)) continue;

    const u = tagUnparseable(stmt);
    if (u !== null) {
      unparseable.push(u);
      continue;
    }

    // Each IDENT in the regex produces 2 capture groups (quoted, bare).
    // CREATE TABLE matches: [_, schema_q, schema_b, name_q, name_b].
    const createMatch = CREATE_TABLE_RE.exec(stmt.text);
    if (createMatch !== null) {
      const schema = pickIdent(createMatch[1], createMatch[2]);
      const name = pickIdent(createMatch[3], createMatch[4]);
      if (schema !== undefined && name !== undefined) {
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
    }

    const alterMatch = ALTER_TABLE_RLS_RE.exec(stmt.text);
    if (alterMatch !== null) {
      const schema = pickIdent(alterMatch[1], alterMatch[2]);
      const name = pickIdent(alterMatch[3], alterMatch[4]);
      if (schema !== undefined && name !== undefined) {
        const key = `${schema}.${name}`;
        const existing = tablesByKey.get(key);
        if (existing !== undefined) {
          tablesByKey.set(key, { ...existing, rls_enabled: true });
        } else {
          tablesByKey.set(key, {
            schema,
            name,
            source_range: { start: stmt.start, end: stmt.end },
            rls_enabled: true,
          });
        }
        continue;
      }
    }

    // CREATE POLICY: [_, name_q, name_b, schema_q, schema_b, table_q, table_b]
    const policyMatch = CREATE_POLICY_RE.exec(stmt.text);
    if (policyMatch !== null) {
      const policyName = pickIdent(policyMatch[1], policyMatch[2]);
      const schema = pickIdent(policyMatch[3], policyMatch[4]);
      const table = pickIdent(policyMatch[5], policyMatch[6]);
      if (policyName !== undefined && schema !== undefined && table !== undefined) {
        const forMatch = POLICY_FOR_RE.exec(stmt.text);
        const op = (forMatch?.[1]?.toUpperCase() as PolicyOp | undefined) ?? 'ALL';
        const toMatch = POLICY_TO_RE.exec(stmt.text);
        const role = toMatch?.[1]?.trim();
        const usingMatch = POLICY_USING_RE.exec(stmt.text);
        const wcMatch = POLICY_WITH_CHECK_RE.exec(stmt.text);
        const policy: ParsedPolicy = {
          name: policyName,
          schema,
          table,
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
    }

    // GRANT ... ON TABLE schema.table TO role
    // [_, privs, schema_q, schema_b, table_q, table_b, role_q, role_b]
    const grantMatch = GRANT_RE.exec(stmt.text);
    if (grantMatch !== null) {
      const privs = grantMatch[1];
      const schema = pickIdent(grantMatch[2], grantMatch[3]);
      const table = pickIdent(grantMatch[4], grantMatch[5]);
      const role = pickIdent(grantMatch[6], grantMatch[7]);
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
