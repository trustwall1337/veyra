/**
 * Static heuristics for authz / tenant-boundary detection.
 *
 * Per PHASE_1_PLAN §4.3: confirm only when evidence is direct;
 * otherwise classify as `likely_issue`, `coverage_gap`, or
 * `missing_evidence`. No `confirmed_issue` from these heuristics.
 */

const SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  'users',
  'accounts',
  'orders',
  'tenants',
  'invoices',
  'payments',
  'customers',
  'subscriptions',
  'documents',
]);

const SUPABASE_FROM_RE =
  /\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)([\s\S]{0,400}?)\.eq\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*,\s*([^)]*?)\)/gi;

const CLIENT_PARAM_RE =
  /(?:params|searchParams)\.get\(\s*['"`](tenant_id|workspace_id|org_id)['"`]\s*\)/i;

export interface AuthzMatch {
  readonly kind: 'cc-11-3' | 'cc-11-4';
  readonly filePath: string;
  readonly line: number;
  readonly excerpt: string;
  readonly table?: string;
}

export interface DetectorOptions {
  readonly fileList: readonly { readonly filePath: string; readonly content: string }[];
  readonly sensitiveTableNames?: readonly string[];
}

export function detectAuthzIssues(
  options: DetectorOptions,
): readonly AuthzMatch[] {
  const sensitive = new Set(
    [...SENSITIVE_NAMES, ...(options.sensitiveTableNames ?? [])].map((s) =>
      s.toLowerCase(),
    ),
  );
  const out: AuthzMatch[] = [];

  for (const { filePath, content } of options.fileList) {
    // cc-11-4: client-provided tenant_id used in a query.
    if (CLIENT_PARAM_RE.test(content)) {
      const idx = content.search(CLIENT_PARAM_RE);
      const line = lineNumberAt(content, idx);
      out.push({
        kind: 'cc-11-4',
        filePath,
        line,
        excerpt: content
          .slice(Math.max(0, idx - 20), idx + 80)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160),
      });
    }

    // cc-11-3: direct object access by id on a sensitive table without
    // a tenant/user filter near the .eq('id', ...) call. We look at
    // .from('<table>')...eq('id', <client>). If the same block also
    // includes .eq('tenant_id'/'user_id') we skip — that's a proper
    // boundary clause.
    for (const m of content.matchAll(SUPABASE_FROM_RE)) {
      const table = m[1]?.toLowerCase();
      const block = m[2] ?? '';
      const eqCol = m[3]?.toLowerCase();
      if (table === undefined || eqCol !== 'id') continue;
      if (!sensitive.has(table)) continue;
      const idx = m.index ?? 0;
      // Look at a window that extends 300 chars after the matched
      // `.from(...).eq('id', ...)`. A proper boundary clause (eq on
      // tenant_id / user_id / workspace_id / org_id) usually chains
      // right after; we treat its presence as evidence that the call
      // site already enforces row-level scope.
      const window = content.slice(idx, idx + 600);
      if (/\.eq\(\s*['"`](?:tenant_id|user_id|workspace_id|org_id)['"`]/i.test(window)) {
        continue;
      }
      const fullMatch = m[0];
      out.push({
        kind: 'cc-11-3',
        filePath,
        line: lineNumberAt(content, idx),
        excerpt: fullMatch.replace(/\s+/g, ' ').trim().slice(0, 200),
        table,
      });
    }
  }
  return out;
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}
