import { describe, expect, it } from 'vitest';

import {
  asConnectorId,
  asParserId,
  asScannerId,
} from './identity.js';
import { isErr } from './result.js';
import {
  assertExhaustiveScanFactContentKind,
  assertExhaustiveScanFactSource,
  type ScanFactContentKind,
  type ScanFactSource,
} from './scan-fact.js';

/**
 * Exhaustiveness check for ScanFactSource.kind. Adding a new variant
 * without extending `describeKind` makes `source` in the default
 * branch no longer `never`, so the compiler rejects the call to
 * `assertExhaustiveScanFactSource`.
 */
function describeKind(source: ScanFactSource): string {
  switch (source.kind) {
    case 'scanner_match':
      return 'scanner_match';
    case 'schema_element':
      return 'schema_element';
    case 'mcp_response':
      return 'mcp_response';
    case 'local_file':
      return 'local_file';
    default:
      return assertExhaustiveScanFactSource(source);
  }
}

function describeContentKind(kind: ScanFactContentKind): string {
  switch (kind) {
    case 'text':
      return 'text';
    case 'sql':
      return 'sql';
    case 'json':
      return 'json';
    case 'yaml':
      return 'yaml';
    case 'redacted_secret_context':
      return 'redacted_secret_context';
    default:
      return assertExhaustiveScanFactContentKind(kind);
  }
}

describe('ScanFactSource exhaustiveness', () => {
  it('every source.kind has a handler', () => {
    const scannerId = asScannerId('test-scanner');
    if (isErr(scannerId)) throw new Error('id');
    const connectorId = asConnectorId('test-conn');
    if (isErr(connectorId)) throw new Error('id');
    const parserId = asParserId('test-parser');
    if (isErr(parserId)) throw new Error('id');

    const samples: ScanFactSource[] = [
      {
        kind: 'scanner_match',
        scanner_id: scannerId.value,
        payload: {
          sanitized_excerpt: 'redacted',
          content_kind: 'text',
        },
      },
      {
        kind: 'schema_element',
        parser_id: parserId.value,
        element_kind: 'table',
        name: 'users',
      },
      {
        kind: 'mcp_response',
        connector_id: connectorId.value,
        tool: 'list_storage_buckets',
        response_digest: 'sha256:abc',
      },
      {
        kind: 'local_file',
        signal_kind: 'env_file_committed',
      },
    ];

    for (const s of samples) {
      expect(describeKind(s)).toBe(s.kind);
    }
  });
});

describe('ScanFactContentKind exhaustiveness', () => {
  it('every content_kind has a handler', () => {
    const kinds: ScanFactContentKind[] = [
      'text',
      'sql',
      'json',
      'yaml',
      'redacted_secret_context',
    ];
    for (const k of kinds) {
      expect(describeContentKind(k)).toBe(k);
    }
  });
});
