/**
 * Scan orchestrator (step 18 — full wiring).
 *
 * Per PHASE_1_PLAN §4.0:
 *  - Agents do not call each other directly. The orchestrator owns
 *    ordering, retries, and dependency wiring.
 *  - Topological sort over `AgentMetadata.declared_dependencies`
 *    (interpreted as agent ids).
 *  - Per-agent try-boundary: a throw inside one agent emits a
 *    `coverage_gap` finding + `agent-<id>.error.json` artifact, never
 *    propagates upward.
 *  - Artifact directory layout is the same across runs given the same
 *    input — append-only per scan id.
 *
 * The registry is a list. No `switch (agentId)` in shared code; agents
 * are addressed by metadata.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type { Finding } from '../../types/finding.js';

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export class CycleError extends Error {
  override readonly name = 'CycleError';
}

export type InputBuilder<I> = (
  context: AgentExecutionContext,
  upstream: ReadonlyMap<string, AgentResult<unknown>>,
) => I;

export interface OrchestratorRunResult {
  readonly status: 'completed';
  readonly findings: readonly Finding[];
  readonly artifacts: readonly ArtifactRef[];
  readonly warnings: readonly string[];
  readonly resultsByAgent: ReadonlyMap<string, AgentResult<unknown>>;
}

export interface ScanOrchestrator {
  register<I, O>(
    agent: VeyraAgent<I, O>,
    buildInput?: InputBuilder<I>,
  ): void;
  run(context: AgentExecutionContext): Promise<OrchestratorRunResult>;
}

interface Registered {
  readonly agent: VeyraAgent<unknown, unknown>;
  readonly buildInput: InputBuilder<unknown>;
}

function topoSort(entries: readonly Registered[]): Registered[] {
  // Subset of declared_dependencies that names another registered
  // agent's id. Anything else is treated as an external artifact /
  // service and ignored for ordering.
  const idSet = new Set(entries.map((e) => e.agent.metadata.id));
  const incoming = new Map<string, Set<string>>();
  for (const e of entries) {
    const deps = new Set<string>();
    for (const d of e.agent.metadata.declared_dependencies) {
      if (idSet.has(d)) deps.add(d);
    }
    incoming.set(e.agent.metadata.id, deps);
  }

  const out: Registered[] = [];
  const byId = new Map(entries.map((e) => [e.agent.metadata.id, e] as const));
  while (incoming.size > 0) {
    const ready = Array.from(incoming.entries())
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => id)
      .sort();
    if (ready.length === 0) {
      throw new CycleError(
        `dependency cycle among agents: ${Array.from(incoming.keys()).join(', ')}`,
      );
    }
    for (const id of ready) {
      const entry = byId.get(id);
      if (entry !== undefined) out.push(entry);
      incoming.delete(id);
      for (const deps of incoming.values()) deps.delete(id);
    }
  }
  return out;
}

function coverageGapFor(
  metadata: AgentMetadata,
  reason: string,
): Finding {
  return {
    id: `orchestrator-${metadata.id}-coverage-gap`,
    control_id: 'cc-orchestrator',
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: `Agent "${metadata.id}" did not complete`,
    summary: `${metadata.id} threw during run: ${reason}. Other agents completed independently. Needs human review.`,
    evidence_refs: [],
  };
}

async function writeErrorArtifact(
  artifactDir: string,
  metadata: AgentMetadata,
  reason: string,
  cause: unknown,
): Promise<ArtifactRef | undefined> {
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    const filePath = path.join(artifactDir, `agent-${metadata.id}.error.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          agent_id: metadata.id,
          agent_version: metadata.version,
          reason,
          stack: cause instanceof Error ? cause.stack : undefined,
          recorded_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    return {
      scanId: 'unknown',
      kind: 'evidence_inventory',
      path: filePath,
    };
  } catch {
    return undefined;
  }
}

export function createScanOrchestrator(): ScanOrchestrator {
  const entries: Registered[] = [];
  return {
    register<I, O>(
      agent: VeyraAgent<I, O>,
      buildInput: InputBuilder<I> = () => ({}) as I,
    ): void {
      entries.push({
        agent: agent as VeyraAgent<unknown, unknown>,
        buildInput: buildInput as InputBuilder<unknown>,
      });
    },
    async run(
      context: AgentExecutionContext,
    ): Promise<OrchestratorRunResult> {
      if (entries.length === 0) {
        throw new NotImplementedError(
          'ScanOrchestrator.run called with no agents registered',
        );
      }
      const order = topoSort(entries);
      const findings: Finding[] = [];
      const artifacts: ArtifactRef[] = [];
      const warnings: string[] = [];
      const resultsByAgent = new Map<string, AgentResult<unknown>>();

      for (const entry of order) {
        const meta = entry.agent.metadata;
        try {
          const input = entry.buildInput(context, resultsByAgent);
          const result = await entry.agent.run(input, context);
          resultsByAgent.set(meta.id, result);
          findings.push(...result.findings);
          artifacts.push(...result.artifacts);
          warnings.push(...result.warnings);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          findings.push(coverageGapFor(meta, reason));
          const errArtifact = await writeErrorArtifact(
            context.artifactDir,
            meta,
            reason,
            cause,
          );
          if (errArtifact !== undefined) {
            artifacts.push({ ...errArtifact, scanId: context.scanId });
          }
          warnings.push(`agent_threw: ${meta.id}: ${reason}`);
          context.logger.warn(
            `orchestrator: agent "${meta.id}" threw: ${reason}`,
          );
        }
      }
      return {
        status: 'completed',
        findings,
        artifacts,
        warnings,
        resultsByAgent,
      };
    },
  };
}
