import type { ScanFact } from '../types/scan-fact.js';
import type { NamedFact, ToolResult } from '../types/tool-result.js';

/**
 * Map a scanner's already-redacted `ScanFact[]` into the whitelist
 * {@link ToolResult} the agentic loop persists (Phase 3 / Agentic Veyra,
 * Step 33). Each `ScanFact` becomes one {@link NamedFact} keyed by its
 * `fact_id`, carrying only safe metadata — never a raw secret (gitleaks runs
 * with `--redact`, and `ScanFact.redacted` records that), and never a
 * classification verdict (the floor in Step 35 is the sole classifier).
 */
export function scanFactsToToolResult(
  facts: readonly ScanFact[],
): ToolResult {
  return {
    facts: facts.map((fact): NamedFact => {
      const fields: NamedFact[] = [
        { name: 'source_kind', value: fact.source.kind },
        { name: 'redacted', value: fact.redacted },
        { name: 'observed_at', value: fact.observed_at },
      ];
      if (fact.file_path !== undefined) {
        fields.push({ name: 'file_path', value: fact.file_path });
      }
      if (fact.line !== undefined) {
        fields.push({ name: 'line', value: fact.line });
      }
      return { name: fact.fact_id, value: fields };
    }),
  };
}
