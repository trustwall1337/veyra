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

import { disposeHypotheses } from '../assertions/hypothesis-disposition.js';
import type { AIConcern } from '../../types/ai-concern.js';
import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type { ContextRequest } from '../../types/context-request.js';
import type { Finding } from '../../types/finding.js';
import type { Hypothesis } from '../../types/hypothesis.js';
import type { ScanFact } from '../../types/scan-fact.js';

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
  /**
   * Pass-2 outputs (revision §4.2). Empty when AI is disabled or no
   * hypotheses were produced.
   */
  readonly aiConcerns: readonly AIConcern[];
  readonly contextRetryCount: number;
}

/**
 * Hook used by AI-enabled scans. The orchestrator calls
 * `collectHypotheses` after Pass-1 finishes, then runs Pass-2 over
 * (findings, hypotheses). When undefined, Pass-2 is a no-op — the
 * scan is deterministic-only.
 */
export interface AiHooks {
  collectHypotheses(
    resultsByAgent: ReadonlyMap<string, AgentResult<unknown>>,
  ): readonly Hypothesis[];
  /**
   * Optional context-evaluator hook used by §4.2 rule 3 retries. The
   * orchestrator forwards each `ContextRequest` and gets back new
   * `ScanFact[]` or an error. Retry cap defaults to 2.
   */
  evaluateContextRequest?: (
    request: ContextRequest,
  ) => Promise<{
    readonly granted: boolean;
    readonly facts?: readonly ScanFact[];
    readonly reason?: string;
  }>;
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

/**
 * Group entries into dependency layers. Each layer contains agents
 * whose declared_dependencies are fully satisfied by previous layers.
 * Within a layer, entries are sorted by id for deterministic order.
 */
function topoLayers(entries: readonly Registered[]): Registered[][] {
  const idSet = new Set(entries.map((e) => e.agent.metadata.id));
  const incoming = new Map<string, Set<string>>();
  for (const e of entries) {
    const deps = new Set<string>();
    for (const d of e.agent.metadata.declared_dependencies) {
      if (idSet.has(d)) deps.add(d);
    }
    incoming.set(e.agent.metadata.id, deps);
  }
  const byId = new Map(entries.map((e) => [e.agent.metadata.id, e] as const));
  const layers: Registered[][] = [];
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
    const layer: Registered[] = [];
    for (const id of ready) {
      const entry = byId.get(id);
      if (entry !== undefined) layer.push(entry);
      incoming.delete(id);
      for (const deps of incoming.values()) deps.delete(id);
    }
    layers.push(layer);
  }
  return layers;
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
    // Append-only safety per §4.0 artifact-store guardrail: refuse to
    // overwrite an existing error artifact for the same agent. If one
    // already exists for this scan-id, append a discriminator.
    const base = `agent-${metadata.id}.error.json`;
    let filePath = path.join(artifactDir, base);
    let suffix = 1;
    // Use exclusive-creation semantics via writeFile + flag='wx'.
    while (true) {
      try {
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
          { encoding: 'utf8', flag: 'wx' },
        );
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw e;
        suffix += 1;
        filePath = path.join(
          artifactDir,
          `agent-${metadata.id}.error.${String(suffix)}.json`,
        );
      }
    }
    return {
      scanId: 'unknown',
      kind: 'evidence_inventory',
      path: filePath,
    };
  } catch {
    return undefined;
  }
}

export interface CreateScanOrchestratorOptions {
  /**
   * Max number of agents to run in parallel within a single
   * dependency layer. Default 1 (deterministic single-threaded
   * execution). Setting >1 enables intra-layer parallelism while
   * preserving the layer ordering imposed by declared_dependencies.
   * Concurrency is a performance optimization, not a semantic
   * change — the resulting findings/artifacts set is identical
   * regardless of value (see scan-orchestrator.test.ts determinism
   * checks).
   */
  readonly maxConcurrency?: number;
  /**
   * AI hooks. When provided, the orchestrator runs Pass-2
   * (hypothesis disposition) after Pass-1 finishes, drives the
   * context-request retry loop, and persists `assertions.json` +
   * `ai-concerns.json`. When undefined, AI is disabled — the scan
   * is deterministic-only.
   */
  readonly ai?: AiHooks;
  /** Retry cap for context requests per §4.2 rule 3. Default 2. */
  readonly contextRetryCap?: number;
}

const DEFAULT_CONTEXT_RETRY_CAP = 2;

async function appendScanActionsLog(
  artifactDir: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const filePath = path.join(artifactDir, 'scan-actions.log');
  const row = JSON.stringify({
    recorded_at: new Date().toISOString(),
    ...entry,
  });
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.appendFile(filePath, row + '\n', 'utf8');
  } catch {
    // log sink failures must not break a scan
  }
}

export function createScanOrchestrator(
  options: CreateScanOrchestratorOptions = {},
): ScanOrchestrator {
  const entries: Registered[] = [];
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 1);
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
      const layers = topoLayers(entries);
      const resultsByAgent = new Map<string, AgentResult<unknown>>();
      const findings: Finding[] = [];
      const artifacts: ArtifactRef[] = [];
      const warnings: string[] = [];
      const trace: { agent_id: string; layer: number; status: 'ok' | 'threw' }[] = [];

      async function runOne(entry: Registered): Promise<{
        id: string;
        result?: AgentResult<unknown>;
        error?: { reason: string; cause: unknown };
      }> {
        const meta = entry.agent.metadata;
        try {
          const input = entry.buildInput(context, resultsByAgent);
          const result = await entry.agent.run(input, context);
          return { id: meta.id, result };
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          return { id: meta.id, error: { reason, cause } };
        }
      }

      for (let layerIdx = 0; layerIdx < layers.length; layerIdx += 1) {
        const layer = layers[layerIdx];
        if (layer === undefined) continue;

        // Bounded-concurrency execution within the layer. We process
        // in fixed-size chunks of `maxConcurrency`; within a chunk we
        // gather results in the layer's sort order (which is
        // deterministic by id) before moving on. This keeps the
        // merged findings/artifacts byte-deterministic regardless of
        // which agent finishes first.
        const layerOutputs: Awaited<ReturnType<typeof runOne>>[] = [];
        for (let i = 0; i < layer.length; i += maxConcurrency) {
          const chunk = layer.slice(i, i + maxConcurrency);
          const chunkResults = await Promise.all(chunk.map(runOne));
          layerOutputs.push(...chunkResults);
        }

        // Sort outputs deterministically by agent id before merging.
        layerOutputs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const out of layerOutputs) {
          const meta = layer.find((e) => e.agent.metadata.id === out.id)?.agent
            .metadata;
          if (meta === undefined) continue;
          if (out.result !== undefined) {
            resultsByAgent.set(out.id, out.result);
            findings.push(...out.result.findings);
            artifacts.push(...out.result.artifacts);
            warnings.push(...out.result.warnings);
            trace.push({ agent_id: out.id, layer: layerIdx, status: 'ok' });
          } else if (out.error !== undefined) {
            findings.push(coverageGapFor(meta, out.error.reason));
            const errArtifact = await writeErrorArtifact(
              context.artifactDir,
              meta,
              out.error.reason,
              out.error.cause,
            );
            if (errArtifact !== undefined) {
              artifacts.push({ ...errArtifact, scanId: context.scanId });
            }
            warnings.push(`agent_threw: ${out.id}: ${out.error.reason}`);
            context.logger.warn(
              `orchestrator: agent "${out.id}" threw: ${out.error.reason}`,
            );
            // Log to scan-actions.log per §12b mid-scan failure rule:
            // a thrown agent is recorded for audit, the scan continues.
            await appendScanActionsLog(context.artifactDir, {
              event: 'agent_threw',
              agent_id: out.id,
              reason: out.error.reason,
            });
            trace.push({ agent_id: out.id, layer: layerIdx, status: 'threw' });
          }
        }
      }

      // ── Pass-2 (revision §4.2) ──────────────────────────────────
      // After all Pass-1 agents finish, run hypothesis disposition.
      // The orchestrator owns the context-request retry loop with
      // hard cap. Pass-2 is the SOLE writer of `assertions.json` and
      // `ai-concerns.json`. AIConcerns from Pass-2 do NOT alter
      // `findings` classification (constraints 1, 7, 9) — they only
      // attach hypotheses to existing findings.
      let aiConcerns: readonly AIConcern[] = [];
      let contextRetryCount = 0;
      let finalFindings: readonly Finding[] = findings;
      const retryCap = options.contextRetryCap ?? DEFAULT_CONTEXT_RETRY_CAP;
      if (options.ai !== undefined) {
        const hypotheses = options.ai.collectHypotheses(resultsByAgent);
        const exhausted = new Set<string>();
        let disposition = disposeHypotheses({
          findings: finalFindings,
          hypotheses,
        });
        // Retry loop for rule-3 context requests. Capped at retryCap;
        // exhausted hypotheses fall through to rule 4 on the final
        // dispose call.
        const evaluator = options.ai.evaluateContextRequest;
        while (
          evaluator !== undefined &&
          disposition.contextRequestsToRetry.length > 0 &&
          contextRetryCount < retryCap
        ) {
          contextRetryCount += 1;
          for (const pending of disposition.contextRequestsToRetry) {
            try {
              const r = await evaluator(pending.request);
              if (!r.granted) {
                exhausted.add(pending.hypothesis_id);
                await appendScanActionsLog(context.artifactDir, {
                  event: 'context_request_denied',
                  hypothesis_id: pending.hypothesis_id,
                  reason: r.reason ?? 'denied',
                });
              }
            } catch (cause) {
              exhausted.add(pending.hypothesis_id);
              const m = cause instanceof Error ? cause.message : String(cause);
              await appendScanActionsLog(context.artifactDir, {
                event: 'context_request_failed',
                hypothesis_id: pending.hypothesis_id,
                reason: m,
              });
            }
          }
          disposition = disposeHypotheses({
            findings: finalFindings,
            hypotheses,
            contextRetryExhausted: exhausted,
          });
        }
        // If cap reached with requests still pending, force exhaustion
        // so the last dispose moves them to rule 4 (AIConcern).
        if (
          disposition.contextRequestsToRetry.length > 0 &&
          contextRetryCount >= retryCap
        ) {
          for (const pending of disposition.contextRequestsToRetry) {
            exhausted.add(pending.hypothesis_id);
            await appendScanActionsLog(context.artifactDir, {
              event: 'context_retry_cap_exhausted',
              hypothesis_id: pending.hypothesis_id,
              cap: retryCap,
            });
          }
          disposition = disposeHypotheses({
            findings: finalFindings,
            hypotheses,
            contextRetryExhausted: exhausted,
          });
        }

        finalFindings = disposition.findings;
        aiConcerns = disposition.aiConcerns;

        // Persist assertions audit + ai-concerns artifacts.
        try {
          await fs.mkdir(context.artifactDir, { recursive: true });
          const aPath = path.join(context.artifactDir, 'assertions.json');
          await fs.writeFile(
            aPath,
            JSON.stringify({ assertions: disposition.assertions }, null, 2),
            'utf8',
          );
          artifacts.push({
            scanId: context.scanId,
            kind: 'evidence_inventory',
            path: aPath,
          });
          const cPath = path.join(context.artifactDir, 'ai-concerns.json');
          await fs.writeFile(
            cPath,
            JSON.stringify({ ai_concerns: aiConcerns }, null, 2),
            'utf8',
          );
          artifacts.push({
            scanId: context.scanId,
            kind: 'evidence_inventory',
            path: cPath,
          });
        } catch (cause) {
          const m = cause instanceof Error ? cause.message : String(cause);
          warnings.push(`pass2_artifact_write_failed: ${m}`);
        }
      }

      // Persist the layer-routing trace artifact (debug-only).
      try {
        await fs.mkdir(context.artifactDir, { recursive: true });
        await fs.writeFile(
          path.join(context.artifactDir, 'scan-trace.json'),
          JSON.stringify({ layers: layers.length, trace }, null, 2),
          'utf8',
        );
      } catch {
        // trace is debug-only; never fail the scan over it.
      }

      return {
        status: 'completed',
        // Post-Pass-2 findings (with supporting_hypothesis_refs
        // attached) when AI ran; otherwise Pass-1 findings unchanged.
        findings: finalFindings,
        artifacts,
        warnings,
        resultsByAgent,
        aiConcerns,
        contextRetryCount,
      };
    },
  };
}
