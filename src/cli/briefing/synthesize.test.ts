import { describe, expect, it } from 'vitest';

import { Budget, DEFAULT_BUDGET_CAPS } from '../../core/orchestrator/loop-budget.js';
import type { InventoryBootstrap } from '../../agents/product-understanding/inventory/types.js';

import {
  DEFAULT_BRIEFING_COST_UNITS,
  recordedBriefingBedrockCaller,
  synthesizeProjectBriefing,
} from './synthesize.js';
import { briefingDigest } from './persist.js';
import { briefingContainsClassificationStringToken } from './validate.js';
import type {
  BriefingBedrockCaller,
  BriefingBedrockResponse,
  ProjectBriefing,
} from './types.js';

function stubInventory(): InventoryBootstrap {
  return {
    observed_evidence: {
      file_map: ['src/index.ts'],
      framework: 'vite',
      routes: [],
      env_declarations: [],
    },
    sources: [],
  };
}

function validAiReturn(): unknown {
  return {
    purpose: { value: 'a sample SaaS app', confidence: 'medium' },
    user_roles: { value: ['admin', 'member'], confidence: 'medium' },
    data_kinds: { value: ['user profiles'], confidence: 'low' },
    auth_model: { value: 'supabase auth', confidence: 'high' },
    sensitive_tables: { value: ['users'], confidence: 'low' },
    dependency_surface: {
      framework: 'vite',
      key_deps: ['@supabase/supabase-js'],
      confidence: 'medium',
    },
    observed_trust_boundaries: { value: ['anon → authenticated'], confidence: 'low' },
  };
}

describe('synthesizeProjectBriefing — V2 structural-only path', () => {
  it('returns synthesis_mode=structural_only with no model_id under --no-ai', async () => {
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.synthesis_mode).toBe('structural_only');
    expect(result.value.model_id).toBeUndefined();
    // AI-only fields carry uncertainty_notes
    expect(result.value.purpose.confidence).toBe('low');
    expect(result.value.purpose.uncertainty_notes).toBe('no_ai_synthesis');
    // Structural field surfaces inventory framework
    expect(result.value.dependency_surface.framework).toBe('vite');
  });
});

describe('synthesizeProjectBriefing — V5 classification-key smuggling', () => {
  it('routes to degraded_fallback when the AI return nests a classification key', async () => {
    const smuggled = {
      ...(validAiReturn() as Record<string, unknown>),
      purpose: {
        value: 'a sample app',
        confidence: 'medium',
        // smuggled at depth via a child object
        meta: { finding_type: 'launch_blocker' },
      },
    };
    const caller: BriefingBedrockCaller = recordedBriefingBedrockCaller([
      { parsed_output: smuggled, model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' },
    ]);
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.synthesis_mode).toBe('degraded_fallback');
  });

  it('rejects classification keys nested inside list payloads', async () => {
    const smuggled = {
      ...(validAiReturn() as Record<string, unknown>),
      dependency_surface: {
        framework: 'vite',
        key_deps: ['@supabase/supabase-js'],
        confidence: 'medium',
        // nested deeper
        meta: [{ review_action: 'fix_before_launch' }],
      },
    };
    const caller: BriefingBedrockCaller = recordedBriefingBedrockCaller([
      { parsed_output: smuggled, model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' },
    ]);
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.synthesis_mode).toBe('degraded_fallback');
  });
});

describe('synthesizeProjectBriefing — V6 classification string-token in scalar', () => {
  it('rejects scalar strings containing classification tokens', () => {
    expect(
      briefingContainsClassificationStringToken({
        purpose: { value: 'finding_type: launch-blocker' },
      }),
    ).toBe(true);
    expect(
      briefingContainsClassificationStringToken({
        dependency_surface: { key_deps: ['ok', 'fix_before_launch'] },
      }),
    ).toBe(true);
  });
  it('allows benign strings', () => {
    expect(
      briefingContainsClassificationStringToken({
        purpose: { value: 'a SaaS app with user records' },
      }),
    ).toBe(false);
  });
});

describe('synthesizeProjectBriefing — V10 AI call failure → degraded_fallback', () => {
  it('persists a degraded_fallback briefing when the AI call throws', async () => {
    const throwingCaller: BriefingBedrockCaller = {
      complete: async () => {
        throw new Error('simulated bedrock outage');
      },
    };
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: throwingCaller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.synthesis_mode).toBe('degraded_fallback');
    expect(result.value.purpose.uncertainty_notes).toContain('ai_synthesis_failed');
  });
});

describe('synthesizeProjectBriefing — V14 loop-budget debit + one-call cap', () => {
  it('debits one tool_call + cost_units before invocation', async () => {
    let invocations = 0;
    const caller: BriefingBedrockCaller = {
      complete: async (): Promise<BriefingBedrockResponse> => {
        invocations += 1;
        return {
          parsed_output: validAiReturn(),
          model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        };
      },
    };
    const budget = new Budget(DEFAULT_BUDGET_CAPS, () => 0);
    const before = budget.snapshot();
    expect(before.tool_calls).toBe(0);
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      loopBudget: budget,
    });
    expect(result.ok).toBe(true);
    expect(invocations).toBe(1);
    const after = budget.snapshot();
    expect(after.tool_calls).toBe(1);
    expect(after.cost_units).toBe(DEFAULT_BRIEFING_COST_UNITS);
  });

  it('refuses a second call against the same budget (one-call hard cap)', async () => {
    let invocations = 0;
    const caller: BriefingBedrockCaller = {
      complete: async (): Promise<BriefingBedrockResponse> => {
        invocations += 1;
        return {
          parsed_output: validAiReturn(),
          model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        };
      },
    };
    const budget = new Budget(DEFAULT_BUDGET_CAPS, () => 0);
    const first = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      loopBudget: budget,
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.synthesis_mode).toBe('ai_assisted');
    const second = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      loopBudget: budget,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.synthesis_mode).toBe('degraded_fallback');
    expect(invocations).toBe(1);
  });

  it('routes to structural_only when the budget is exhausted pre-call (no debit, no invocation)', async () => {
    const exhaustedBudget = new Budget(
      { ...DEFAULT_BUDGET_CAPS, max_tool_calls: 0 },
      () => 0,
    );
    let invocations = 0;
    const caller: BriefingBedrockCaller = {
      complete: async (): Promise<BriefingBedrockResponse> => {
        invocations += 1;
        return {
          parsed_output: validAiReturn(),
          model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        };
      },
    };
    const result = await synthesizeProjectBriefing({
      inventory: stubInventory(),
      aiOptIn: true,
      bedrockCaller: caller,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      loopBudget: exhaustedBudget,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.synthesis_mode).toBe('structural_only');
    expect(invocations).toBe(0);
  });
});

describe('briefingDigest — V1/V4 recorded-fixture determinism', () => {
  it('is byte-identical across reruns with different recorded_at values', () => {
    const baseAi = validAiReturn() as Record<string, unknown>;
    const briefing1: ProjectBriefing = {
      ...(baseAi as unknown as Omit<ProjectBriefing, 'synthesis_mode' | 'recorded_at'>),
      synthesis_mode: 'ai_assisted',
      model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      prompt_fingerprint_sha256: 'aabbcc',
      recorded_at: '2026-06-11T16:00:00.000Z',
    };
    const briefing2: ProjectBriefing = { ...briefing1, recorded_at: '2026-06-11T17:00:00.000Z' };
    expect(briefingDigest(briefing1)).toBe(briefingDigest(briefing2));
  });
  it('differs when a non-recorded_at field changes', () => {
    const baseAi = validAiReturn() as Record<string, unknown>;
    const briefing1: ProjectBriefing = {
      ...(baseAi as unknown as Omit<ProjectBriefing, 'synthesis_mode' | 'recorded_at'>),
      synthesis_mode: 'ai_assisted',
      model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      recorded_at: '2026-06-11T16:00:00.000Z',
    };
    const briefing2: ProjectBriefing = {
      ...briefing1,
      model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:1',
    };
    expect(briefingDigest(briefing1)).not.toBe(briefingDigest(briefing2));
  });
});

describe('ProjectBriefing — V13 FPP §2A: purpose.value is string', () => {
  it('compiles with a generic string and accepts arbitrary app categories', () => {
    const briefing: ProjectBriefing = {
      purpose: { value: 'a github-style PR review SaaS', confidence: 'medium' },
      user_roles: { value: [], confidence: 'low' },
      data_kinds: { value: [], confidence: 'low' },
      auth_model: { value: 'github oauth', confidence: 'medium' },
      sensitive_tables: { value: [], confidence: 'low' },
      dependency_surface: { framework: 'next', key_deps: [], confidence: 'low' },
      observed_trust_boundaries: { value: [], confidence: 'low' },
      synthesis_mode: 'structural_only',
      recorded_at: '2026-06-11T16:00:00.000Z',
    };
    // The TypeScript compiler accepting this literal is the assertion; the
    // runtime check is just that the field is a string.
    expect(typeof briefing.purpose.value).toBe('string');
  });
});
