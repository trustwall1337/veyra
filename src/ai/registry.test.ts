import { describe, expect, it } from 'vitest';

import { asProviderId } from '../types/identity.js';

import { createDefaultProviderRegistry } from './registry.js';

describe('createDefaultProviderRegistry', () => {
  it('registers anthropic as available with ANTHROPIC_API_KEY', () => {
    const registry = createDefaultProviderRegistry();
    const anthropic = registry.resolve('anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic?.availability.kind).toBe('available');
    if (anthropic?.availability.kind === 'available') {
      expect(anthropic.availability.envVarName).toBe('ANTHROPIC_API_KEY');
    }
  });

  it('registers openai as deferred with a Phase 2 message pointing at the plan doc', () => {
    const registry = createDefaultProviderRegistry();
    const openai = registry.resolve('openai');
    expect(openai).toBeDefined();
    expect(openai?.availability.kind).toBe('deferred');
    if (openai?.availability.kind === 'deferred') {
      expect(openai.availability.deferredMessage).toContain('Phase 2');
      expect(openai.availability.deferredMessage).toContain(
        'phases/phase-2/PHASE_2_PLAN.md',
      );
    }
  });

  it('returns undefined for an unknown provider id', () => {
    const registry = createDefaultProviderRegistry();
    expect(registry.resolve('bedrock')).toBeUndefined();
    expect(registry.resolve('')).toBeUndefined();
  });

  it('lists both Phase 1 entries', () => {
    const registry = createDefaultProviderRegistry();
    const ids = registry.list().map((e) => e.id as string);
    expect(ids).toEqual(['anthropic', 'openai']);
  });

  it('returns ProviderId-branded ids (FPP §2A — no raw string union leaks out)', () => {
    const registry = createDefaultProviderRegistry();
    const entry = registry.resolve('anthropic');
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    // A branded ProviderId widens to string and is interchangeable with
    // `asProviderId('anthropic').value` (same underlying value).
    const minted = asProviderId('anthropic');
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(entry.id as string).toBe(minted.value as string);
    }
  });
});
