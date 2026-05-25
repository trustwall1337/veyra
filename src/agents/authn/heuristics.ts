/**
 * Static heuristics for authn detection.
 *
 * Per PHASE_1_PLAN §4.2: server-side checks via SSR/middleware may
 * exist but not be detected by a static pass. The detector therefore
 * reports `likely_issue`, never `confirmed_issue`.
 */

// cc-11-1 — client-side `if (!user)` guard with a navigate/redirect call.
// Matches across newlines to catch the common formatted pattern where
// the if-test and the navigate call sit on separate lines.
const CLIENT_GUARD_RE =
  /if\s*\(\s*!\s*(?:user|res\.data\.user|session|res\.data\.session)\b[\s\S]{0,40}?\)\s*\{?[\s\S]{0,80}?(?:navigate|redirect|router\.push|window\.location)/gi;

// cc-11-2 — admin route markers.
const ADMIN_PATH_RE = /\bpath\s*=\s*["'`](\/admin[^"'`]*)["'`]/i;
const REQUIRE_ADMIN_RE = /\b(?:requireAdmin|RequireAdmin|isAdminGuard)\b/;

// Anti-markers — when present anywhere in the project (in code, not in
// comments), suggest a server-side role check exists and we should NOT
// flag cc-11-2. The bare-word `is_admin` is too permissive on its own
// (fixture comments mention it as a missing predicate); each marker is
// anchored to a code-like context (call site, equality test, decorator).
const SERVER_ROLE_CHECK_RES: readonly RegExp[] = [
  /\bis_admin\s*[=(:]/,
  /user\.role\s*===?\s*['"`]admin/,
  /hasRole\s*\(\s*['"`]admin/,
  /requireRole\s*\(/,
  /currentUserHasRole\s*\(/,
  /\bRBAC\.\w/,
];

function hasServerRoleCheck(content: string): boolean {
  // Drop // ... and /* ... */ comments before testing so doc-style
  // mentions don't suppress the finding.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return SERVER_ROLE_CHECK_RES.some((re) => re.test(stripped));
}

export interface AuthnRouteFinding {
  readonly kind: 'cc-11-1' | 'cc-11-2';
  readonly filePath: string;
  readonly line: number;
  readonly excerpt: string;
}

export interface DetectorOptions {
  readonly fileList: readonly { readonly filePath: string; readonly content: string }[];
}

export function detectAuthnIssues(
  options: DetectorOptions,
): readonly AuthnRouteFinding[] {
  const out: AuthnRouteFinding[] = [];
  const projectHasServerRoleCheck = options.fileList.some(({ content }) =>
    hasServerRoleCheck(content),
  );

  for (const { filePath, content } of options.fileList) {
    // cc-11-1: client-side guard pattern. Multi-line capable; one
    // finding per match. The regex carries the `g` flag so matchAll
    // walks all occurrences in the file.
    for (const m of content.matchAll(CLIENT_GUARD_RE)) {
      const idx = m.index ?? 0;
      const line = lineNumberAt(content, idx);
      out.push({
        kind: 'cc-11-1',
        filePath,
        line,
        excerpt: m[0].replace(/\s+/g, ' ').trim().slice(0, 160),
      });
    }

    // cc-11-2: admin route or requireAdmin without server-side role check.
    if (!projectHasServerRoleCheck) {
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (ADMIN_PATH_RE.test(line) || REQUIRE_ADMIN_RE.test(line)) {
          out.push({
            kind: 'cc-11-2',
            filePath,
            line: idx + 1,
            excerpt: line.trim().slice(0, 160),
          });
        }
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
