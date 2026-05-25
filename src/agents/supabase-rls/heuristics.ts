/**
 * Sensitive-table classification.
 *
 * Per step 09 Guardrails: the canonical exact-name list and the
 * pattern-regex list are BOTH checked-in code, not inferred at runtime.
 * Adding a name = code change + fixture update.
 */

export type SensitivityStrength = 'high' | 'medium';

export interface SensitivityClassification {
  readonly strength: SensitivityStrength;
  readonly matched_via: 'exact_name' | 'pattern' | 'none';
  readonly pattern_label?: string;
}

const CANONICAL_NAMES: ReadonlySet<string> = new Set([
  'users',
  'accounts',
  'orders',
  'tenants',
  'invoices',
  'payments',
  'customers',
  'subscriptions',
]);

const PATTERN_REGEXES: readonly {
  readonly re: RegExp;
  readonly label: string;
}[] = [
  { re: /_secrets$/i, label: '*_secrets' },
  { re: /_pii$/i, label: '*_pii' },
  { re: /_private$/i, label: '*_private' },
  { re: /_admin$/i, label: '*_admin' },
  { re: /_audit$/i, label: '*_audit' },
];

export function classifyTable(name: string): SensitivityClassification {
  if (CANONICAL_NAMES.has(name.toLowerCase())) {
    return { strength: 'high', matched_via: 'exact_name' };
  }
  for (const p of PATTERN_REGEXES) {
    if (p.re.test(name)) {
      return {
        strength: 'medium',
        matched_via: 'pattern',
        pattern_label: p.label,
      };
    }
  }
  return { strength: 'medium', matched_via: 'none' };
}

export function isSensitive(name: string): boolean {
  const c = classifyTable(name);
  return c.matched_via !== 'none';
}
