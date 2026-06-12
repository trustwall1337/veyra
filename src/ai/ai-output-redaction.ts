/**
 * Stable-alias redactor for tool outputs that re-enter the AI loop view
 * (Phase 3 / Agentic Veyra, Step 34, PLAN §D.4; mechanism carried from
 * PLAN-v1 §D.C). The AI never sees a raw URL, email, token, or UUID — each
 * match is replaced with `REDACTED_<KIND>_<N>`. The same raw value within a
 * scan maps to the same alias, so the AI can correlate "this URL again"
 * across steps without ever holding the secret. The alias map is persisted
 * separately (`redaction-alias-map.json`) for audit.
 *
 * Per CLAUDE.md §Secrets: no raw secret value crosses this boundary into the
 * loop view or the audit trail; the `result_digest` recorded in the trace is
 * the hash of the REDACTED parsed result, not the raw invoke output.
 */

export type RedactionKind = 'URL' | 'EMAIL' | 'TOKEN' | 'ID';

interface PatternDef {
  readonly kind: RedactionKind;
  readonly regex: RegExp;
}

// Order matters: TOKEN before URL (so a Bearer-prefixed token is not partially
// matched as a URL fragment); EMAIL before URL (avoids the email host being
// captured as a URL); ID last (UUID is the most generic).
const PATTERNS: readonly PatternDef[] = [
  {
    kind: 'TOKEN',
    // GitHub PAT / OpenAI / Stripe / generic Bearer; conservative but bounded.
    regex:
      /\b(?:Bearer\s+)?(?:sk_[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_-]{8,}|ghs_[A-Za-z0-9_-]{8,}|gho_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    kind: 'EMAIL',
    regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  },
  {
    kind: 'URL',
    regex: /https?:\/\/[^\s"'<>`]+/g,
  },
  {
    kind: 'ID',
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
];

export interface AliasEntry {
  readonly kind: RedactionKind;
  readonly alias: string;
  readonly first_seen_step?: number;
}

export interface Redactor {
  /** Redact one string (replaces all matched substrings in-place). */
  redactString(value: string): string;
  /** Recursively redact any value (object/array/string/scalar). */
  redact<T>(value: T): T;
  /** Snapshot of the alias table (for `redaction-alias-map.json`). */
  aliasMap(): readonly AliasEntry[];
}

/** Build a per-scan stable-alias redactor. */
export function createRedactor(): Redactor {
  const counters: Record<RedactionKind, number> = {
    URL: 0,
    EMAIL: 0,
    TOKEN: 0,
    ID: 0,
  };
  // raw value → alias (per kind, but same raw value collides only within one kind)
  const aliasByRaw = new Map<string, AliasEntry>();

  function aliasFor(kind: RedactionKind, raw: string): string {
    const existing = aliasByRaw.get(raw);
    if (existing !== undefined) return existing.alias;
    counters[kind] += 1;
    const alias = `REDACTED_${kind}_${String(counters[kind])}`;
    aliasByRaw.set(raw, { kind, alias });
    return alias;
  }

  function redactString(value: string): string {
    let out = value;
    for (const { kind, regex } of PATTERNS) {
      out = out.replace(regex, (match) => aliasFor(kind, match));
    }
    return out;
  }

  function redact<T>(value: T): T {
    if (typeof value === 'string') return redactString(value) as unknown as T;
    if (Array.isArray(value)) {
      return value.map((v) => redact(v)) as unknown as T;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redact(v);
      }
      return out as unknown as T;
    }
    return value;
  }

  return {
    redactString,
    redact,
    aliasMap: () => Array.from(aliasByRaw.values()),
  };
}
