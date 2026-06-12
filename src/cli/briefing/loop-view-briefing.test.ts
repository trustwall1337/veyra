import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runAgenticLoop } from '../../core/orchestrator/agentic-loop.js';
import type {
  AiDriver,
  AiProposalEnvelope,
} from '../../core/orchestrator/agentic-loop.js';
import type { LoopView } from '../../core/orchestrator/artifact-state.js';
import { createToolRegistry } from '../../core/tools/registry.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

import type { ProjectBriefing } from './types.js';

/**
 * V3 — `view.briefing` reaches the AI driver on every `proposeNext` call.
 *
 * Constructs a stub `ProjectBriefing`, feeds the loop a driver that
 * records every `view` it sees, runs the loop with a stub driver that
 * immediately signals `done`, asserts the briefing surfaced.
 */

function stubBriefing(): ProjectBriefing {
  return {
    purpose: { value: 'test app', confidence: 'medium' },
    user_roles: { value: ['admin'], confidence: 'low' },
    data_kinds: { value: [], confidence: 'low' },
    auth_model: { value: 'supabase', confidence: 'medium' },
    sensitive_tables: { value: [], confidence: 'low' },
    dependency_surface: { framework: 'vite', key_deps: [], confidence: 'low' },
    observed_trust_boundaries: { value: [], confidence: 'low' },
    synthesis_mode: 'ai_assisted',
    model_id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    recorded_at: '2026-06-11T00:00:00.000Z',
  };
}

function stubPolicy(): ValidationPolicy {
  return {
    mode: 'read_only_evidence',
    environment: 'local',
    allowed_actions: new Set(['read_code', 'read_schema_metadata']),
    forbidden_actions: new Set(),
  };
}

describe('V3 — LoopView.briefing flows through to proposeNext', () => {
  it('every proposeNext receives view.briefing equal to the seeded briefing', async () => {
    const seenBriefings: (ProjectBriefing | undefined)[] = [];
    const driver: AiDriver = {
      proposeNext: async (view: LoopView): Promise<AiProposalEnvelope> => {
        seenBriefings.push(view.briefing);
        return { proposal: { kind: 'done' } };
      },
    };

    const briefing = stubBriefing();
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40d-v3-'),
    );

    const result = await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-1', projectPath: artifactDir, artifactDir },
      artifactDir,
      briefing,
      briefingDigest: 'deadbeef',
    });

    expect(['done', 'early_done']).toContain(result.termination);
    expect(seenBriefings.length).toBeGreaterThanOrEqual(1);
    for (const seen of seenBriefings) {
      expect(seen).toBeDefined();
      expect(seen?.purpose.value).toBe('test app');
      expect(seen?.synthesis_mode).toBe('ai_assisted');
    }
  });

  it('view.briefing is undefined when no briefing is supplied (legacy path)', async () => {
    const seen: (ProjectBriefing | undefined)[] = [];
    const driver: AiDriver = {
      proposeNext: async (view: LoopView): Promise<AiProposalEnvelope> => {
        seen.push(view.briefing);
        return { proposal: { kind: 'done' } };
      },
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40d-v3b-'),
    );
    const result = await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-1', projectPath: artifactDir, artifactDir },
      artifactDir,
    });
    expect(['done', 'early_done']).toContain(result.termination);
    for (const s of seen) expect(s).toBeUndefined();
  });
});

describe('V4 — briefing_digest only on row 0 of loop-trace.jsonl', () => {
  it('row 0 carries briefing_digest; subsequent rows omit it', async () => {
    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => ({
        proposal: { kind: 'done' },
      }),
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40d-v4-'),
    );
    const result = await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-1', projectPath: artifactDir, artifactDir },
      artifactDir,
      briefing: stubBriefing(),
      briefingDigest: 'fixed-digest-abc',
    });
    expect(['done', 'early_done']).toContain(result.termination);

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const text = await fs.readFile(tracePath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.briefing_digest).toBe('fixed-digest-abc');
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]?.briefing_digest).toBeUndefined();
    }
  });
});
