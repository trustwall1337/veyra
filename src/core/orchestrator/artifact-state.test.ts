import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ToolResult } from '../../types/tool-result.js';

import { ArtifactState } from './artifact-state.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-state-'));
}

const result = (facts: ToolResult['facts']): ToolResult => ({ facts });

describe('ArtifactState', () => {
  it('records an accepted result; toolSucceeded + facts reflect it', async () => {
    const state = new ArtifactState({ artifactDir: await tmpDir() });
    state.writeToolResult(
      'read-code',
      result([{ name: 'file', value: 'app.ts' }]),
      'digest-1',
      5,
    );
    expect(state.toolSucceeded('read-code')).toBe(true);
    expect(state.toolSucceeded('run-gitleaks')).toBe(false);
    expect(state.collectAcceptedFacts()).toEqual([
      { name: 'file', value: 'app.ts' },
    ]);
  });

  it('a rejected result leaves no fact and no success', async () => {
    const state = new ArtifactState({ artifactDir: await tmpDir() });
    state.recordToolResultReject('bad-tool', 'result failed schema', 3);
    state.recordToolError('crash-tool', 'TypeError', 2);
    expect(state.toolSucceeded('bad-tool')).toBe(false);
    expect(state.toolSucceeded('crash-tool')).toBe(false);
    expect(state.collectAcceptedFacts()).toEqual([]);
  });

  it('result-reject records reason only, never a raw payload', async () => {
    const state = new ArtifactState({ artifactDir: await tmpDir() });
    state.recordToolResultReject('bad-tool', 'result failed schema', 3);
    const rec = state.records().find((r) => r.kind === 'tool_result_reject');
    expect(rec?.reason).toBe('result failed schema');
    // No payload field exists on the record shape.
    expect(Object.keys(rec ?? {})).not.toContain('payload');
  });

  it('hasArtifact reflects files written to the scan dir', async () => {
    const dir = await tmpDir();
    const state = new ArtifactState({ artifactDir: dir });
    expect(state.hasArtifact('database-metadata.json')).toBe(false);
    await fs.writeFile(path.join(dir, 'database-metadata.json'), '{}', 'utf8');
    expect(state.hasArtifact('database-metadata.json')).toBe(true);
  });

  it('readableView surfaces steps and accepted facts', async () => {
    const state = new ArtifactState({ artifactDir: await tmpDir() });
    state.recordDenial('forbidden-tool', 'not allowed');
    state.writeToolResult('read-code', result([{ name: 'n', value: 1 }]), 'd', 1);
    const view = state.readableView();
    expect(view.steps.map((s) => s.kind)).toEqual(['denial', 'tool_accepted']);
    expect(view.facts).toEqual([{ name: 'n', value: 1 }]);
  });

  it('counts declared probe attempts (Mode B ledger)', async () => {
    const state = new ArtifactState({ artifactDir: await tmpDir() });
    expect(state.probeAttemptCount()).toBe(0);
    state.recordProbeAttempt();
    expect(state.probeAttemptCount()).toBe(1);
  });
});
