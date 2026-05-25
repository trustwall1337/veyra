import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AiProvider, AiRequest, AiResponse } from '../../ai/types.js';
import { asProviderId } from '../../types/identity.js';
import { isErr, isOk, ok as okR } from '../../types/result.js';

import {
  AI_INTENT_ARTIFACT_NAME,
  buildAiDeclaredIntent,
  writeAiDeclaredIntentArtifact,
} from './agent.js';

function fakeProvider(parsed: unknown): AiProvider {
  const id = asProviderId('anthropic');
  if (!id.ok) throw id.error;
  return {
    id: id.value,
    complete: async (_req: AiRequest) => {
      const response: AiResponse = {
        model_id: 'claude-sonnet-4-6',
        output_text: JSON.stringify(parsed),
        parsed_output: parsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return okR(response);
    },
  };
}

async function writeInventory(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-aipu-'));
  const inv = {
    observed_evidence: {
      file_map: ['package.json', 'src/App.tsx'],
      package_json_digest: {
        name: 'demo',
        dependencies: { vite: '^5', react: '^18' },
      },
      routes: ['/dashboard', '/admin'],
      framework: 'vite',
      env_declarations: ['VITE_SUPABASE_URL'],
    },
    sources: [],
  };
  const p = path.join(dir, 'inventory-bootstrap.json');
  await fs.writeFile(p, JSON.stringify(inv, null, 2));
  return p;
}

describe('buildAiDeclaredIntent', () => {
  it('calls the AI provider with a sanitized prompt and returns a parsed declared_intent', async () => {
    const inv = await writeInventory();
    const provider = fakeProvider({
      purpose: { value: 'demo', confidence: 'medium' },
      user_roles: { value: ['user', 'admin'], confidence: 'high' },
      data_kinds: { value: ['profile', 'order'], confidence: 'high' },
      auth_model: {
        value: 'Supabase Auth with admin role',
        confidence: 'medium',
      },
    });
    const r = await buildAiDeclaredIntent({
      inventoryArtifactPath: inv,
      provider,
      model: 'claude-sonnet-4-6',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.declared_intent.purpose?.value).toBe('demo');
      expect(r.value.declared_intent.user_roles?.value).toContain('admin');
      expect(r.value.model_id).toBe('claude-sonnet-4-6');
      expect(r.value.prompt_fingerprint_sha256.length).toBe(64);
    }
  });

  it('returns an error when the inventory artifact is missing', async () => {
    const provider = fakeProvider({});
    const r = await buildAiDeclaredIntent({
      inventoryArtifactPath: '/nope/missing.json',
      provider,
      model: 'm',
    });
    expect(isErr(r)).toBe(true);
  });

  it('returns an error when the provider response has no parsed_output', async () => {
    const inv = await writeInventory();
    const id = asProviderId('anthropic');
    if (!id.ok) throw id.error;
    const broken: AiProvider = {
      id: id.value,
      complete: async () =>
        okR({
          model_id: 'm',
          output_text: '',
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
    };
    const r = await buildAiDeclaredIntent({
      inventoryArtifactPath: inv,
      provider: broken,
      model: 'm',
    });
    expect(isErr(r)).toBe(true);
  });
});

describe('writeAiDeclaredIntentArtifact', () => {
  it('writes ai-declared-intent.json (no observed_evidence in the artifact)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-aipu-w-'));
    const r = await writeAiDeclaredIntentArtifact(dir, {
      declared_intent: {
        purpose: { value: 'demo', confidence: 'medium' },
      },
      model_id: 'm',
      prompt_fingerprint_sha256: '0'.repeat(64),
      observed_at: '2026-05-25T00:00:00Z',
    });
    expect(isOk(r)).toBe(true);
    const text = await fs.readFile(
      path.join(dir, AI_INTENT_ARTIFACT_NAME),
      'utf8',
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['observed_evidence']).toBeUndefined();
    expect(parsed['declared_intent']).toBeDefined();
  });
});
