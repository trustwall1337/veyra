import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  AiProvider,
  AiRequest,
  AiResponse,
} from '../../ai/types.js';
import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { asProviderId } from '../../types/identity.js';
import { ok } from '../../types/result.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { productUnderstandingAgent } from './agent.js';

function logger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-pu-'));
  return {
    scanId: 'scan',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: logger(),
  };
}

function fakeAiProvider(parsed: unknown): AiProvider {
  const id = asProviderId('anthropic');
  if (!id.ok) throw id.error;
  return {
    id: id.value,
    complete: async (_req: AiRequest) => {
      const r: AiResponse = {
        model_id: 'claude-sonnet-4-6',
        output_text: '',
        parsed_output: parsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return ok(r);
    },
  };
}

describe('productUnderstandingAgent — no_ai path (default)', () => {
  it('emits inventory-bootstrap.json and declared-context.json (no ai intent)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    const r = await productUnderstandingAgent.run(
      { projectRoot: fixtureRoot },
      c,
    );
    expect(r.status).toBe('completed');
    if (r.status === 'completed' && r.output !== undefined) {
      expect(r.output.mode).toBe('no_ai');
      expect(r.output.aiIntentArtifactPath).toBeUndefined();
    }
    const written = await fs.readdir(c.artifactDir);
    expect(written).toContain('inventory-bootstrap.json');
    expect(written).toContain('declared-context.json');
    expect(written).not.toContain('ai-declared-intent.json');
  });

  it('declared-context.json carries observed_evidence and empty declared_intent', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    await productUnderstandingAgent.run({ projectRoot: fixtureRoot }, c);
    const text = await fs.readFile(
      path.join(c.artifactDir, 'declared-context.json'),
      'utf8',
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['observed_evidence']).toBeDefined();
    // Per retro-17c: no-AI mode derives a low-confidence fallback
    // intent from inventory hints. The fixture has Vite + supabase
    // deps + recognisable route shapes, so we expect at least one
    // field to be populated.
    const intent = parsed['declared_intent'] as Record<string, unknown>;
    expect(intent).toBeDefined();
    // Every populated field must carry confidence: 'low'.
    for (const v of Object.values(intent)) {
      const f = v as { confidence?: string };
      if (f.confidence !== undefined) expect(f.confidence).toBe('low');
    }
  });
});

describe('productUnderstandingAgent — ai_enabled path', () => {
  it('emits ai-declared-intent.json AND declared-context.json with merged intent', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    const provider = fakeAiProvider({
      purpose: { value: 'demo SaaS', confidence: 'medium' },
      user_roles: { value: ['user', 'admin'], confidence: 'high' },
      data_kinds: { value: ['order', 'document'], confidence: 'high' },
      auth_model: {
        value: 'Supabase Auth with client-side guard',
        confidence: 'medium',
      },
    });
    const r = await productUnderstandingAgent.run(
      { projectRoot: fixtureRoot, aiProvider: provider, aiModel: 'm' },
      c,
    );
    expect(r.status).toBe('completed');
    if (r.status === 'completed' && r.output !== undefined) {
      expect(r.output.mode).toBe('ai_enabled');
      expect(r.output.aiIntentArtifactPath).toBeDefined();
    }
    const dc = JSON.parse(
      await fs.readFile(
        path.join(c.artifactDir, 'declared-context.json'),
        'utf8',
      ),
    ) as { declared_intent?: { purpose?: { value?: string } } };
    expect(dc.declared_intent?.purpose?.value).toBe('demo SaaS');
  });
});
