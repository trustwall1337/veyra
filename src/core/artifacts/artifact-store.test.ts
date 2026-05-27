import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ArtifactKind } from '../../types/artifact.js';
import type { Finding } from '../../types/finding.js';
import { isErr, isOk } from '../../types/result.js';

import { createFsArtifactStore } from './artifact-store.js';

describe('artifact-store', () => {
  it('roundtrips Finding[] with shape preserved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-store-'));
    const store = createFsArtifactStore(root);

    const findings: Finding[] = [
      {
        id: 'f1',
        control_id: 'rls.policies',
        finding_type: 'likely_issue',
        evidence_strength: 'medium',
        reproducibility: 'static',
        review_action: 'review_before_launch',
        blast_radius: 'tenant_data',
        title: 'sample',
        summary: 'sample summary',
        evidence_refs: ['ev1'],
      },
    ];

    const writeResult = await store.write(
      'scan-123',
      'scan_facts',
      findings,
    );
    if (isErr(writeResult)) {
      throw new Error(`write failed: ${writeResult.error.message}`);
    }

    const readResult = await store.read(writeResult.value);
    if (isErr(readResult)) {
      throw new Error(`read failed: ${readResult.error.message}`);
    }

    expect(readResult.value.value).toEqual(findings);
    expect(readResult.value.ref.scanId).toBe('scan-123');
    expect(readResult.value.ref.kind).toBe('scan_facts');
  });

  it('refuses to overwrite an existing artifact (append-only)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-store-'));
    const store = createFsArtifactStore(root);

    const a = await store.write('scan-x', 'declared_context', { v: 1 });
    expect(isOk(a)).toBe(true);

    const b = await store.write('scan-x', 'declared_context', { v: 2 });
    expect(isErr(b)).toBe(true);
  });

  it('maps each Phase 3 additive ArtifactKind to its on-disk basename (step 30)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-store-p3-'));
    const store = createFsArtifactStore(root);

    const expected: ReadonlyArray<readonly [ArtifactKind, string]> = [
      ['loop_trace', 'loop-trace.jsonl'],
      ['tool_error', 'tool-error.json'],
      ['tool_result_reject', 'tool-result-reject.json'],
      ['required_evidence_ledger', 'required-evidence-ledger.json'],
      ['redaction_alias_map', 'redaction-alias-map.json'],
      ['subagent_error', 'subagent-error.json'],
    ];

    for (const [kind, basename] of expected) {
      const r = await store.write('scan-p3', kind, { ok: true });
      if (isErr(r)) {
        throw new Error(`write failed for ${kind}: ${r.error.message}`);
      }
      expect(path.basename(r.value.path)).toBe(basename);
    }
  });
});
