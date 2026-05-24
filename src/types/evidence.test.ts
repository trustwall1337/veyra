import { describe, expect, it } from 'vitest';

import { type EvidenceItem, assertExhaustive } from './evidence.js';
import { asConnectorId, asScannerId } from './identity.js';
import { isErr } from './result.js';

/**
 * The point of this test is the compile-time exhaustiveness check on the
 * `default` branch. If a new EvidenceKind is added to evidence.ts and
 * `summarize` is not extended, TypeScript fails the build: `ev` in the
 * default branch is no longer `never`, so `assertExhaustive(ev)` errors.
 */
function summarize(ev: EvidenceItem): string {
  switch (ev.source) {
    case 'static_code':
      return `code:${ev.file}`;
    case 'mcp_context':
      return `mcp:${ev.tool}`;
    case 'scanner':
      return `scanner:${ev.finding_id}`;
    case 'active_validation':
      return `active:${ev.test_id}`;
    case 'cleanup_proof':
      return `cleanup:${ev.scan_id}`;
    default:
      return assertExhaustive(ev);
  }
}

describe('EvidenceItem exhaustiveness', () => {
  it('handles every EvidenceKind without falling through to assertExhaustive', () => {
    const connectorId = asConnectorId('test-conn');
    if (isErr(connectorId)) throw new Error('id');
    const scannerId = asScannerId('test-scanner');
    if (isErr(scannerId)) throw new Error('id');

    const samples: EvidenceItem[] = [
      { id: 'e1', source: 'static_code', file: 'a.ts' },
      {
        id: 'e2',
        source: 'mcp_context',
        server: connectorId.value,
        tool: 't',
        request_fingerprint: 'fp',
      },
      {
        id: 'e3',
        source: 'scanner',
        scanner: scannerId.value,
        finding_id: 'fid',
      },
      {
        id: 'e4',
        source: 'active_validation',
        test_id: 't1',
        outcome: 'proven_denial',
        synthetic_data_refs: [],
      },
      {
        id: 'e5',
        source: 'cleanup_proof',
        scan_id: 's1',
        residual_count: 0,
      },
    ];

    for (const ev of samples) {
      expect(summarize(ev)).not.toBe('');
    }
  });
});
