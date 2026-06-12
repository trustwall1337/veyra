import {
  asConnectorId,
  asParserId,
  asScannerId,
} from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';
import type {
  ScanFact,
  ScanFactContentKind,
  ScanFactPayload,
  ScanFactSource,
} from '../../types/scan-fact.js';
import type { FactValue, NamedFact } from '../../types/tool-result.js';

/**
 * Step 35b — the inverse of `scanFactsToToolResult` (Phase 3 / Agentic Veyra,
 * PLAN §B + §D). Walks the `NamedFact[]` the agentic loop has accepted (via
 * `ArtifactState.collectAcceptedFacts()`) and re-discriminates each entry back
 * to a `ScanFact`. Never throws: malformed input becomes
 * `err(NamedFactDecodeError)` so the floor records a single internal
 * `coverage_gap` and continues with the ledger gaps.
 *
 * The bridge runs AFTER the loop's `result_schema.safeParse` boundary — every
 * fact reaching this function has already cleared the whitelist + recursive
 * classification-key guard (`src/types/tool-result.ts:83-103`).
 */

const CONTENT_KINDS: readonly ScanFactContentKind[] = [
  'text',
  'sql',
  'json',
  'yaml',
  'redacted_secret_context',
];

export class NamedFactDecodeError extends Error {
  override readonly name = 'NamedFactDecodeError';
}

export function namedFactsToScanFacts(
  facts: readonly NamedFact[],
): Result<readonly ScanFact[], NamedFactDecodeError> {
  const out: ScanFact[] = [];
  for (const fact of facts) {
    const decoded = decodeOne(fact);
    if (!decoded.ok) return decoded;
    if (decoded.value !== undefined) {
      out.push(decoded.value);
    }
  }
  return ok(out);
}

function decodeOne(
  fact: NamedFact,
): Result<ScanFact | undefined, NamedFactDecodeError> {
  // The top-level NamedFact carries the fact_id as `name` and the field
  // list as `value`. Only nested NamedFact[] is a valid value here; anything
  // else means this NamedFact didn't come from `scanFactsToToolResult` and we
  // skip it (returning `undefined` rather than failing the whole batch — the
  // loop may persist tool-specific facts that aren't ScanFacts).
  if (!isNamedFactArray(fact.value)) return ok(undefined);
  const fields = indexByName(fact.value);

  const sourceKind = readString(fields, 'source_kind');
  if (sourceKind === undefined) return ok(undefined);

  const redacted = readBoolean(fields, 'redacted');
  const observedAt = readString(fields, 'observed_at');
  const argsFingerprint = readString(fields, 'args_fingerprint_sha256');
  if (
    redacted === undefined ||
    observedAt === undefined ||
    argsFingerprint === undefined
  ) {
    return err(
      new NamedFactDecodeError(
        `decode "${fact.name}": missing required top-level field (redacted/observed_at/args_fingerprint_sha256)`,
      ),
    );
  }

  const sourceFieldsRaw = fields.get('source_fields');
  const sourceFields =
    sourceFieldsRaw !== undefined && isNamedFactArray(sourceFieldsRaw)
      ? indexByName(sourceFieldsRaw)
      : new Map<string, FactValue>();

  const sourceR = decodeSource(sourceKind, sourceFields);
  if (!sourceR.ok) return sourceR;

  const filePath = readString(fields, 'file_path');
  const line = readNumber(fields, 'line');

  const result: ScanFact = {
    fact_id: fact.name,
    source: sourceR.value,
    observed_at: observedAt,
    args_fingerprint_sha256: argsFingerprint,
    redacted,
    ...(filePath !== undefined ? { file_path: filePath } : {}),
    ...(line !== undefined ? { line } : {}),
  };
  return ok(result);
}

function decodeSource(
  kind: string,
  fields: ReadonlyMap<string, FactValue>,
): Result<ScanFactSource, NamedFactDecodeError> {
  switch (kind) {
    case 'scanner_match': {
      const scannerIdStr = readString(fields, 'scanner_id');
      if (scannerIdStr === undefined) {
        return err(
          new NamedFactDecodeError(
            'scanner_match: scanner_id missing in source_fields',
          ),
        );
      }
      const scannerIdR = asScannerId(scannerIdStr);
      if (!scannerIdR.ok) {
        return err(new NamedFactDecodeError(scannerIdR.error.message));
      }
      const payloadR = readPayload(fields, /*required*/ true);
      if (!payloadR.ok) return payloadR;
      if (payloadR.value === undefined) {
        return err(
          new NamedFactDecodeError(
            'scanner_match: payload missing (required for ScannerMatchSource)',
          ),
        );
      }
      return ok({
        kind: 'scanner_match',
        scanner_id: scannerIdR.value,
        payload: payloadR.value,
      });
    }
    case 'schema_element': {
      const parserIdStr = readString(fields, 'parser_id');
      const elementKind = readString(fields, 'element_kind');
      const name = readString(fields, 'name');
      if (
        parserIdStr === undefined ||
        elementKind === undefined ||
        name === undefined
      ) {
        return err(
          new NamedFactDecodeError(
            'schema_element: missing parser_id/element_kind/name in source_fields',
          ),
        );
      }
      const parserIdR = asParserId(parserIdStr);
      if (!parserIdR.ok) {
        return err(new NamedFactDecodeError(parserIdR.error.message));
      }
      const payloadR = readPayload(fields, /*required*/ false);
      if (!payloadR.ok) return payloadR;
      return ok({
        kind: 'schema_element',
        parser_id: parserIdR.value,
        element_kind: elementKind,
        name,
        ...(payloadR.value !== undefined ? { payload: payloadR.value } : {}),
      });
    }
    case 'mcp_response': {
      const connectorIdStr = readString(fields, 'connector_id');
      const tool = readString(fields, 'tool');
      const responseDigest = readString(fields, 'response_digest');
      if (
        connectorIdStr === undefined ||
        tool === undefined ||
        responseDigest === undefined
      ) {
        return err(
          new NamedFactDecodeError(
            'mcp_response: missing connector_id/tool/response_digest in source_fields',
          ),
        );
      }
      const connectorIdR = asConnectorId(connectorIdStr);
      if (!connectorIdR.ok) {
        return err(new NamedFactDecodeError(connectorIdR.error.message));
      }
      const payloadR = readPayload(fields, /*required*/ false);
      if (!payloadR.ok) return payloadR;
      return ok({
        kind: 'mcp_response',
        connector_id: connectorIdR.value,
        tool,
        response_digest: responseDigest,
        ...(payloadR.value !== undefined ? { payload: payloadR.value } : {}),
      });
    }
    case 'local_file': {
      const signalKind = readString(fields, 'signal_kind');
      if (signalKind === undefined) {
        return err(
          new NamedFactDecodeError(
            'local_file: signal_kind missing in source_fields',
          ),
        );
      }
      const payloadR = readPayload(fields, /*required*/ false);
      if (!payloadR.ok) return payloadR;
      return ok({
        kind: 'local_file',
        signal_kind: signalKind,
        ...(payloadR.value !== undefined ? { payload: payloadR.value } : {}),
      });
    }
    case 'probe_response': {
      const probeId = readString(fields, 'probe_id');
      const controlId = readString(fields, 'control_id');
      if (probeId === undefined || controlId === undefined) {
        return err(
          new NamedFactDecodeError(
            'probe_response: probe_id or control_id missing in source_fields',
          ),
        );
      }
      const payloadRaw = fields.get('payload');
      if (payloadRaw === undefined || !isNamedFactArray(payloadRaw)) {
        return err(
          new NamedFactDecodeError('probe_response: payload missing'),
        );
      }
      const p = indexByName(payloadRaw);
      const status = readNumber(p, 'response_status');
      const returnedRows = readBoolean(p, 'response_returned_rows');
      const sizeBytes = readNumber(p, 'response_size_bytes');
      const digest = readString(p, 'response_digest');
      const expectation = readString(p, 'expectation');
      if (
        status === undefined ||
        returnedRows === undefined ||
        sizeBytes === undefined ||
        digest === undefined ||
        (expectation !== 'expect_denial' && expectation !== 'expect_allow')
      ) {
        return err(
          new NamedFactDecodeError(
            'probe_response: missing or invalid payload fields',
          ),
        );
      }
      return ok({
        kind: 'probe_response',
        probe_id: probeId,
        control_id: controlId,
        payload: {
          response_status: status,
          response_returned_rows: returnedRows,
          response_size_bytes: sizeBytes,
          response_digest: digest,
          expectation,
        },
      });
    }
    default:
      return err(
        new NamedFactDecodeError(`unknown source_kind: "${kind}"`),
      );
  }
}

function readPayload(
  fields: ReadonlyMap<string, FactValue>,
  required: boolean,
): Result<ScanFactPayload | undefined, NamedFactDecodeError> {
  const raw = fields.get('payload');
  if (raw === undefined) {
    return required
      ? err(new NamedFactDecodeError('payload missing'))
      : ok(undefined);
  }
  if (!isNamedFactArray(raw)) {
    return err(new NamedFactDecodeError('payload: expected NamedFact[]'));
  }
  const p = indexByName(raw);
  const sanitized = readString(p, 'sanitized_excerpt');
  const contentKindStr = readString(p, 'content_kind');
  if (sanitized === undefined || contentKindStr === undefined) {
    return err(
      new NamedFactDecodeError(
        'payload: missing sanitized_excerpt or content_kind',
      ),
    );
  }
  if (!(CONTENT_KINDS as readonly string[]).includes(contentKindStr)) {
    return err(
      new NamedFactDecodeError(
        `payload: unknown content_kind "${contentKindStr}"`,
      ),
    );
  }
  const ruleId = readString(p, 'rule_id');
  const sourceArtifactPath = readString(p, 'source_artifact_path');
  // byte_range optional, decode if present
  let byteRange: ScanFactPayload['byte_range'] | undefined;
  const br = p.get('byte_range');
  if (br !== undefined && isNamedFactArray(br)) {
    const brFields = indexByName(br);
    const start = readNumber(brFields, 'start');
    const end = readNumber(brFields, 'end');
    if (start !== undefined && end !== undefined) {
      byteRange = { start, end };
    }
  }
  const payload: ScanFactPayload = {
    sanitized_excerpt: sanitized,
    content_kind: contentKindStr as ScanFactContentKind,
    ...(ruleId !== undefined ? { rule_id: ruleId } : {}),
    ...(byteRange !== undefined ? { byte_range: byteRange } : {}),
    ...(sourceArtifactPath !== undefined
      ? { source_artifact_path: sourceArtifactPath }
      : {}),
  };
  return ok(payload);
}

// ── small helpers ───────────────────────────────────────────────────────────

function isNamedFactArray(v: FactValue): v is readonly NamedFact[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v as readonly unknown[])[0] === 'object' &&
    (v as readonly NamedFact[])[0] !== undefined &&
    'name' in ((v as readonly NamedFact[])[0] as object) &&
    'value' in ((v as readonly NamedFact[])[0] as object)
  );
}

function indexByName(
  facts: readonly NamedFact[],
): ReadonlyMap<string, FactValue> {
  const m = new Map<string, FactValue>();
  for (const f of facts) m.set(f.name, f.value);
  return m;
}

function readString(
  m: ReadonlyMap<string, FactValue>,
  k: string,
): string | undefined {
  const v = m.get(k);
  return typeof v === 'string' ? v : undefined;
}

function readNumber(
  m: ReadonlyMap<string, FactValue>,
  k: string,
): number | undefined {
  const v = m.get(k);
  return typeof v === 'number' ? v : undefined;
}

function readBoolean(
  m: ReadonlyMap<string, FactValue>,
  k: string,
): boolean | undefined {
  const v = m.get(k);
  return typeof v === 'boolean' ? v : undefined;
}
