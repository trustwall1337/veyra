import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../../types/result.js';

import {
  DECLARED_CONTEXT_ARTIFACT_NAME,
  buildDeclaredContext,
  writeDeclaredContextArtifact,
} from './builder.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-dcb-'));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

const VALID_INVENTORY = {
  observed_evidence: {
    file_map: ['package.json'],
    routes: [],
    framework: 'vite',
    env_declarations: [],
  },
  sources: [],
};

const VALID_AI = {
  declared_intent: {
    purpose: { value: 'demo', confidence: 'medium' },
  },
  model_id: 'claude-sonnet-4-6',
  prompt_fingerprint_sha256: '0'.repeat(64),
  observed_at: '2026-05-25T00:00:00Z',
};

describe('buildDeclaredContext — happy path', () => {
  it('merges inventory observed_evidence + ai declared_intent into one artifact', async () => {
    const dir = await tmpDir();
    const inv = path.join(dir, 'inv.json');
    const aiP = path.join(dir, 'ai.json');
    await writeJson(inv, VALID_INVENTORY);
    await writeJson(aiP, VALID_AI);
    const r = await buildDeclaredContext({
      inventoryArtifactPath: inv,
      aiIntentArtifactPath: aiP,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.observed_evidence.framework).toBe('vite');
      expect(r.value.declared_intent.purpose?.value).toBe('demo');
      expect(r.value.sources).toHaveLength(2);
    }
  });

  it('builds a declared-context without AI input (--no-ai path) — derives deterministic fallback intent', async () => {
    const dir = await tmpDir();
    const inv = path.join(dir, 'inv.json');
    await writeJson(inv, VALID_INVENTORY);
    const r = await buildDeclaredContext({ inventoryArtifactPath: inv });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      // Per retro-17c: --no-ai mode derives a low-confidence intent
      // from inventory hints rather than returning {} so the report
      // still has something under the declared-intent tier.
      // VALID_INVENTORY has framework=vite, so the purpose field
      // should be populated with confidence: 'low'.
      const intent = r.value.declared_intent as Record<string, unknown>;
      expect(intent['purpose']).toBeDefined();
      const purpose = intent['purpose'] as { confidence?: string };
      expect(purpose.confidence).toBe('low');
      expect(r.value.sources).toHaveLength(1);
    }
  });

  it('declared_intent stays {} when inventory carries no detectable hints', async () => {
    const dir = await tmpDir();
    const inv = path.join(dir, 'inv.json');
    // observed_evidence with nothing but file_map / framework=unknown.
    await writeJson(inv, {
      observed_evidence: {
        file_map: [],
        routes: [],
        framework: 'unknown',
        env_declarations: [],
      },
      sources: [],
    });
    const r = await buildDeclaredContext({ inventoryArtifactPath: inv });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.declared_intent).toEqual({});
    }
  });
});

describe('buildDeclaredContext — field-by-owner enforcement', () => {
  it('rejects an inventory artifact that tries to set declared_intent', async () => {
    const dir = await tmpDir();
    const inv = path.join(dir, 'inv.json');
    await writeJson(inv, {
      ...VALID_INVENTORY,
      declared_intent: {
        purpose: { value: 'spoofed', confidence: 'high' },
      },
    });
    const r = await buildDeclaredContext({ inventoryArtifactPath: inv });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.message).toContain('declared_intent');
      expect(r.error.message).toContain('forbidden');
    }
  });

  it('rejects an AI artifact that tries to set observed_evidence', async () => {
    const dir = await tmpDir();
    const inv = path.join(dir, 'inv.json');
    const aiP = path.join(dir, 'ai.json');
    await writeJson(inv, VALID_INVENTORY);
    await writeJson(aiP, {
      ...VALID_AI,
      observed_evidence: {
        file_map: ['spoofed.ts'],
      },
    });
    const r = await buildDeclaredContext({
      inventoryArtifactPath: inv,
      aiIntentArtifactPath: aiP,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.message).toContain('observed_evidence');
      expect(r.error.message).toContain('forbidden');
    }
  });
});

describe('writeDeclaredContextArtifact', () => {
  it('writes the file under the artifact dir', async () => {
    const dir = await tmpDir();
    const r = await writeDeclaredContextArtifact(dir, {
      observed_evidence: VALID_INVENTORY.observed_evidence as never,
      declared_intent: {},
      sources: [],
    });
    expect(isOk(r)).toBe(true);
    const written = await fs.readdir(dir);
    expect(written).toContain(DECLARED_CONTEXT_ARTIFACT_NAME);
  });
});

describe('cross-module isolation', () => {
  it('the composer does not import the AI provider SDK', async () => {
    const source = await fs.readFile(
      new URL('./builder.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('@anthropic-ai/sdk');
    expect(source).not.toContain("from '../../ai/anthropic");
    expect(source).not.toContain("from '../../ai/types");
  });
});
