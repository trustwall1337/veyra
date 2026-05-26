import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createScanActionsLogger,
  fingerprintActionArgs,
} from './scan-actions-log.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-sal-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('scan-actions-log — happy path', () => {
  it('append + summarize roundtrip', async () => {
    const logger = createScanActionsLogger(workdir, 'scan-1');
    await logger.append({
      timestamp: '2026-05-26T00:00:00Z',
      scan_id: 'scan-1',
      action_id: 'ai_call_001',
      action_type: 'ai_call',
      args_fingerprint_sha256: fingerprintActionArgs({ model_id: 'sonnet' }),
      outcome: 'ok',
      duration_ms: 123,
    });
    await logger.append({
      timestamp: '2026-05-26T00:00:01Z',
      scan_id: 'scan-1',
      action_id: 'admin_call_001',
      action_type: 'admin_api_call',
      args_fingerprint_sha256: fingerprintActionArgs({ tool: 'createUser' }),
      outcome: 'ok',
      duration_ms: 50,
    });
    const summary = await logger.summarize();
    expect(summary.total_entries).toBe(2);
    expect(summary.by_action_type['ai_call']).toBe(1);
    expect(summary.by_outcome['ok']).toBe(2);

    const text = await readFile(logger.logPath, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(2);
  });
});

describe('scan-actions-log — defense in depth (CLAUDE.md §Secrets)', () => {
  it('refuses an entry whose args_fingerprint_sha256 is not 64-char hex', async () => {
    const logger = createScanActionsLogger(workdir, 'scan-1');
    const r = await logger.append({
      timestamp: '2026-05-26T00:00:00Z',
      scan_id: 'scan-1',
      action_id: 'bad',
      action_type: 'ai_call',
      // Raw JWT-like string instead of a hex fingerprint:
      args_fingerprint_sha256: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      outcome: 'ok',
      duration_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('not a 64-char hex');
  });

  it('refuses an entry with mismatched scan_id', async () => {
    const logger = createScanActionsLogger(workdir, 'scan-1');
    const r = await logger.append({
      timestamp: '2026-05-26T00:00:00Z',
      scan_id: 'scan-DIFFERENT',
      action_id: 'a',
      action_type: 'ai_call',
      args_fingerprint_sha256: fingerprintActionArgs({}),
      outcome: 'ok',
      duration_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('scan_id mismatch');
  });

  it('refuses high-entropy values in context_tags', async () => {
    const logger = createScanActionsLogger(workdir, 'scan-1');
    const r = await logger.append({
      timestamp: '2026-05-26T00:00:00Z',
      scan_id: 'scan-1',
      action_id: 'a',
      action_type: 'admin_api_call',
      args_fingerprint_sha256: fingerprintActionArgs({}),
      outcome: 'ok',
      duration_ms: 1,
      context_tags: {
        // Likely a service-role key snuck into a context tag:
        suspicious: 'AAAA1234567890BBBB1234567890CCCC1234567890DDDD',
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('high-entropy');
  });

  it('SHA-256 fingerprint is deterministic and 64-char hex', () => {
    const a = fingerprintActionArgs({ tool: 'createUser', scan_id: 'x' });
    const b = fingerprintActionArgs({ tool: 'createUser', scan_id: 'x' });
    expect(a).toBe(b);
    expect(/^[0-9a-f]{64}$/.test(a)).toBe(true);
  });
});
