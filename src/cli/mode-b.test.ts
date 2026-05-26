import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MODE_B_CONFIRMATION_PHRASE,
  checkApprovalAndConsume,
  isAcceptedConfirmation,
  isValidEnvVarName,
  looksLikeKeyValue,
  readApprovalFile,
} from './mode-b.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-modeb-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const VALID_APPROVAL = {
  scan_id_prefix: 'veyra-',
  granted_at: '2026-05-26T00:00:00Z',
  granted_by: 'rm@example.invalid',
  scope: {
    project_ref: 'sbref01234567890a',
    max_synthetic_records: 100,
    expires_at: '2026-06-26T00:00:00Z',
    max_scans: 3,
  },
  signature: 'untrusted-stub-signature-placeholder',
};

describe('looksLikeKeyValue (parser guard for --supabase-service-role-key)', () => {
  it('flags JWT-shaped values', () => {
    expect(looksLikeKeyValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')).toBe(true);
  });

  it('flags long high-entropy base64 strings', () => {
    expect(looksLikeKeyValue('AAAA1234567890BBBB1234567890CCCC1234567890DDDD')).toBe(true);
  });

  it('flags sb_ / sbp_ Supabase-style prefixed strings', () => {
    expect(looksLikeKeyValue('sbp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')).toBe(true);
  });

  it('does NOT flag legit env-var NAMES', () => {
    expect(looksLikeKeyValue('VEYRA_SERVICE_ROLE_KEY')).toBe(false);
    expect(looksLikeKeyValue('SUPABASE_SERVICE_ROLE_KEY')).toBe(false);
  });
});

describe('isValidEnvVarName', () => {
  it('accepts SHOUTY_CASE env-var names', () => {
    expect(isValidEnvVarName('SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    expect(isValidEnvVarName('VEYRA_TEST_KEY_42')).toBe(true);
  });

  it('rejects lowercase / leading digit / spaces', () => {
    expect(isValidEnvVarName('supabase_role_key')).toBe(false);
    expect(isValidEnvVarName('42_KEY')).toBe(false);
    expect(isValidEnvVarName('VEYRA TEST')).toBe(false);
  });
});

describe('isAcceptedConfirmation (interactive prompt)', () => {
  it('only accepts the exact phrase', () => {
    expect(isAcceptedConfirmation(MODE_B_CONFIRMATION_PHRASE)).toBe(true);
    expect(isAcceptedConfirmation('yes')).toBe(false);
    expect(isAcceptedConfirmation('y')).toBe(false);
    expect(isAcceptedConfirmation('YES-I-UNDERSTAND-THIS-MUTATES-SANDBOX')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isAcceptedConfirmation(`  ${MODE_B_CONFIRMATION_PHRASE}\n`)).toBe(true);
  });
});

describe('readApprovalFile', () => {
  it('parses a well-formed approval JSON file', async () => {
    const p = path.join(workdir, 'approval.json');
    await writeFile(p, JSON.stringify(VALID_APPROVAL), 'utf8');
    const r = await readApprovalFile(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scope.project_ref).toBe('sbref01234567890a');
      expect(r.value.scope.max_scans).toBe(3);
    }
  });

  it('rejects malformed JSON', async () => {
    const p = path.join(workdir, 'broken.json');
    await writeFile(p, 'not-json', 'utf8');
    const r = await readApprovalFile(p);
    expect(r.ok).toBe(false);
  });

  it('rejects missing scope fields', async () => {
    const p = path.join(workdir, 'partial.json');
    await writeFile(
      p,
      JSON.stringify({ ...VALID_APPROVAL, scope: { project_ref: 'sbref01234567890a' } }),
      'utf8',
    );
    const r = await readApprovalFile(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('scope missing required');
  });
});

describe('checkApprovalAndConsume (scope + expiry + counter)', () => {
  it('rejects when project_ref does NOT match --supabase-sandbox', async () => {
    const p = path.join(workdir, 'approval.json');
    await writeFile(p, JSON.stringify(VALID_APPROVAL), 'utf8');
    const af = await readApprovalFile(p);
    if (!af.ok) throw af.error;
    const r = await checkApprovalAndConsume({
      approvalFilePath: p,
      approvalFile: af.value,
      supabaseSandboxRef: 'differentprojref01',
      now: new Date('2026-05-26T01:00:00Z'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('does not match');
  });

  it('rejects expired approvals', async () => {
    const p = path.join(workdir, 'approval.json');
    await writeFile(p, JSON.stringify(VALID_APPROVAL), 'utf8');
    const af = await readApprovalFile(p);
    if (!af.ok) throw af.error;
    const r = await checkApprovalAndConsume({
      approvalFilePath: p,
      approvalFile: af.value,
      supabaseSandboxRef: 'sbref01234567890a',
      now: new Date('2027-01-01T00:00:00Z'), // after expires_at
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('expired');
  });

  it('counter increments + persists across reads', async () => {
    const p = path.join(workdir, 'approval.json');
    await writeFile(p, JSON.stringify(VALID_APPROVAL), 'utf8');
    const af = await readApprovalFile(p);
    if (!af.ok) throw af.error;

    // First scan.
    const r1 = await checkApprovalAndConsume({
      approvalFilePath: p,
      approvalFile: af.value,
      supabaseSandboxRef: 'sbref01234567890a',
      now: new Date('2026-05-26T01:00:00Z'),
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.scansAfterConsume).toBe(1);

    // Second scan.
    const r2 = await checkApprovalAndConsume({
      approvalFilePath: p,
      approvalFile: af.value,
      supabaseSandboxRef: 'sbref01234567890a',
      now: new Date('2026-05-26T02:00:00Z'),
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.scansAfterConsume).toBe(2);

    // Confirm usage file is persisted.
    const usageText = await readFile(`${p}.usage.json`, 'utf8');
    const usage = JSON.parse(usageText) as { scans_consumed: number };
    expect(usage.scans_consumed).toBe(2);
  });

  it('rejects when max_scans reached', async () => {
    const p = path.join(workdir, 'approval.json');
    await writeFile(p, JSON.stringify(VALID_APPROVAL), 'utf8');
    // Pre-populate usage file to max-1, then a single consumption fills it,
    // and the next one should fail.
    await writeFile(`${p}.usage.json`, JSON.stringify({ scans_consumed: 3 }), 'utf8');
    const af = await readApprovalFile(p);
    if (!af.ok) throw af.error;
    const r = await checkApprovalAndConsume({
      approvalFilePath: p,
      approvalFile: af.value,
      supabaseSandboxRef: 'sbref01234567890a',
      now: new Date('2026-05-26T01:00:00Z'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('max_scans reached');
  });
});
