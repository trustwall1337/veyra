import type { ScanFact, ScanFactSource } from '../types/scan-fact.js';
import type { NamedFact, ToolResult } from '../types/tool-result.js';

/**
 * Map a scanner's already-redacted `ScanFact[]` into the whitelist
 * {@link ToolResult} the agentic loop persists (Phase 3 / Agentic Veyra,
 * Steps 33 + 35b). Each `ScanFact` becomes one {@link NamedFact} keyed by its
 * `fact_id`, carrying only safe metadata — never a raw secret (gitleaks runs
 * with `--redact`, and `ScanFact.redacted` records that), and never a
 * classification verdict (the floor in Step 35 is the sole classifier).
 *
 * Step 35b: the emit is now LOSSLESS on the fields the post-loop deterministic
 * floor's predicates dispatch on (`source.kind`, `source.scanner_id` /
 * `parser_id` / `connector_id`, `source.payload.rule_id`,
 * `source.payload.content_kind`, `source.payload.sanitized_excerpt`,
 * `args_fingerprint_sha256`, plus the schema_element / mcp_response /
 * local_file shape fields). The inverse `namedFactToScanFact` in
 * `src/core/orchestrator/named-fact-to-scan-fact.ts` reverses this for the
 * floor; round-trip is asserted in tests. Every field is a `NamedFact` so the
 * whitelist contract and the recursive classification-key guard
 * (`src/types/tool-result.ts:83-103`) are preserved.
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
        { name: 'args_fingerprint_sha256', value: fact.args_fingerprint_sha256 },
      ];
      if (fact.file_path !== undefined) {
        fields.push({ name: 'file_path', value: fact.file_path });
      }
      if (fact.line !== undefined) {
        fields.push({ name: 'line', value: fact.line });
      }
      // Source-kind-specific fields. Each branch flattens the ScanFactSource
      // into a structured `source_fields` NamedFact[] so the inverse bridge
      // can re-discriminate by `source_kind`.
      const sourceFields = emitSourceFields(fact.source);
      if (sourceFields.length > 0) {
        fields.push({ name: 'source_fields', value: sourceFields });
      }
      return { name: fact.fact_id, value: fields };
    }),
  };
}

function emitSourceFields(source: ScanFactSource): readonly NamedFact[] {
  switch (source.kind) {
    case 'scanner_match': {
      const out: NamedFact[] = [
        { name: 'scanner_id', value: String(source.scanner_id) },
      ];
      out.push({ name: 'payload', value: emitPayloadFields(source.payload) });
      return out;
    }
    case 'schema_element': {
      const out: NamedFact[] = [
        { name: 'parser_id', value: String(source.parser_id) },
        { name: 'element_kind', value: source.element_kind },
        { name: 'name', value: source.name },
      ];
      if (source.payload !== undefined) {
        out.push({
          name: 'payload',
          value: emitPayloadFields(source.payload),
        });
      }
      return out;
    }
    case 'mcp_response': {
      const out: NamedFact[] = [
        { name: 'connector_id', value: String(source.connector_id) },
        { name: 'tool', value: source.tool },
        { name: 'response_digest', value: source.response_digest },
      ];
      if (source.payload !== undefined) {
        out.push({
          name: 'payload',
          value: emitPayloadFields(source.payload),
        });
      }
      return out;
    }
    case 'local_file': {
      const out: NamedFact[] = [
        { name: 'signal_kind', value: source.signal_kind },
      ];
      if (source.payload !== undefined) {
        out.push({
          name: 'payload',
          value: emitPayloadFields(source.payload),
        });
      }
      return out;
    }
    case 'probe_response': {
      const out: NamedFact[] = [
        { name: 'probe_id', value: source.probe_id },
        { name: 'control_id', value: source.control_id },
        {
          name: 'payload',
          value: [
            {
              name: 'response_status',
              value: source.payload.response_status,
            },
            {
              name: 'response_returned_rows',
              value: source.payload.response_returned_rows,
            },
            {
              name: 'response_size_bytes',
              value: source.payload.response_size_bytes,
            },
            {
              name: 'response_digest',
              value: source.payload.response_digest,
            },
            { name: 'expectation', value: source.payload.expectation },
          ],
        },
      ];
      return out;
    }
  }
}

function emitPayloadFields(
  payload: import('../types/scan-fact.js').ScanFactPayload,
): readonly NamedFact[] {
  const out: NamedFact[] = [
    { name: 'sanitized_excerpt', value: payload.sanitized_excerpt },
    { name: 'content_kind', value: payload.content_kind },
  ];
  if (payload.rule_id !== undefined) {
    out.push({ name: 'rule_id', value: payload.rule_id });
  }
  if (payload.byte_range !== undefined) {
    out.push({
      name: 'byte_range',
      value: [
        { name: 'start', value: payload.byte_range.start },
        { name: 'end', value: payload.byte_range.end },
      ],
    });
  }
  if (payload.source_artifact_path !== undefined) {
    out.push({
      name: 'source_artifact_path',
      value: payload.source_artifact_path,
    });
  }
  return out;
}
