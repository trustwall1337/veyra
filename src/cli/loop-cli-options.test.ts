import { describe, expect, it } from 'vitest';

import { isErr } from '../types/result.js';

import {
  DEFAULT_MODE_B_SUBMODE,
  parseLoopCliOptions,
} from './loop-cli-options.js';

describe('Step 40 — loop CLI options (Verification a)', () => {
  it('Mode B default sub-mode is b2_auto_synthesize (D2)', () => {
    const r = parseLoopCliOptions({ mode: 'mode_b', env: 'dev' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.modeBSubMode).toBe('b2_auto_synthesize');
    expect(DEFAULT_MODE_B_SUBMODE).toBe('b2_auto_synthesize');
  });

  it('Mode B with explicit manifest opt-in selects b1_manifest', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_b',
      env: 'sandbox',
      modeBSubMode: 'manifest',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.modeBSubMode).toBe('b1_manifest');
  });
});

describe('Step 40 — --loop-budget (Verification b)', () => {
  it('parses calls/wall_ms/cost/steps into Partial<BudgetCaps> overrides', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_a',
      env: 'dev',
      loopBudget: 'calls=10,wall_ms=60000,cost=500000,steps=50',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.loopBudget).toEqual({
      max_tool_calls: 10,
      max_wall_clock_ms: 60000,
      max_ai_cost_units: 500000,
      max_steps: 50,
    });
  });

  it('rejects an unknown loop-budget key', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_a',
      env: 'dev',
      loopBudget: 'frobnicate=10',
    });
    expect(isErr(r)).toBe(true);
  });
});

describe('Step 40 — --env production + Mode B → reject (Verification c)', () => {
  it('rejects Mode B against production', () => {
    const r = parseLoopCliOptions({ mode: 'mode_b', env: 'production' });
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.message).toContain('production');
  });

  it('Mode A against production is allowed (read-only evidence)', () => {
    const r = parseLoopCliOptions({ mode: 'mode_a', env: 'production' });
    expect(r.ok).toBe(true);
  });
});

describe('Step 40 — --no-ai routes to plan-walker (Verification d)', () => {
  it('sets noAi: true on the parsed options', () => {
    const r = parseLoopCliOptions({ mode: 'mode_a', env: 'dev', noAi: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.noAi).toBe(true);
  });
});

describe('Step 40 — approval flow + signature stub (Verification e)', () => {
  it('exposes the approval-file path + acknowledges the signature stub (default true)', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_b',
      env: 'sandbox',
      approvalFile: '/tmp/approval.json',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.approvalFile).toBe('/tmp/approval.json');
    // The stub status is acknowledged in the option, never silently bypassed.
    expect(r.value.skipSignatureVerify).toBe(true);
  });
});

describe('Step 40 — no credential on argv (Verification f)', () => {
  it('rejects --service-role-key on argv', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_b',
      env: 'dev',
      rawArgv: ['--service-role-key=eyJ...REDACTED'],
    });
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.message).toContain('--service-role-key');
  });

  it('rejects --aws-access-key-id on argv', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_b',
      env: 'dev',
      rawArgv: ['--aws-access-key-id', 'AKIA...'],
    });
    expect(isErr(r)).toBe(true);
  });

  it('accepts argv without secret-shaped flags', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_a',
      env: 'dev',
      rawArgv: ['--project', '/path/to/app', '--no-ai'],
    });
    expect(r.ok).toBe(true);
  });
});
