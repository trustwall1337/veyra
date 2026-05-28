import { createHash } from 'node:crypto';

import type { Finding } from '../../types/finding.js';
import { isErr } from '../../types/result.js';
import {
  type NamedFact,
  containsClassificationKey,
} from '../../types/tool-result.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';
import { enforce } from '../policy/tool-policy.js';
import { type ToolContext } from '../tools/descriptor.js';
import type { ToolRegistry } from '../tools/registry.js';

import { ArtifactState } from './artifact-state.js';
import {
  type AgenticLoopResult,
  type LoopTermination,
} from './agentic-loop.js';
import { runClassificationPredicates } from './floor.js';
import {
  type LedgerGap,
  RequiredEvidenceLedger,
} from './required-evidence-ledger.js';

/**
 * `--no-ai` deterministic plan-walker (Phase 3 / Agentic Veyra, Step 32, PLAN
 * §E option b + `decisions.md` D5). Drives the SAME tool catalog the agentic
 * loop drives, through the SAME policy gate + result-parse-or-reject boundary,
 * into the SAME deterministic floor — only the driver differs. Read-only tools
 * get full offline coverage; a tool that needs an AI-authored target (a
 * "write probe") is **not** run with a synthesized target — it emits exactly
 * one floor `coverage_gap` with the explicit offline reason. That keeps
 * `--no-ai` honest.
 *
 * Replaces the deterministic-fallback role of the deprecated
 * `ai-security-planner` agent.
 */

/**
 * Policy actions that require an AI-authored target (request shape / method /
 * URL / assertion). Under `--no-ai` the plan-walker refuses to invoke these
 * with a synthesized guess; each registered tool whose `required_action` is in
 * this set yields one `coverage_gap` Finding.
 */
const WRITE_PROBE_ACTIONS: ReadonlySet<AllowedAction> = new Set<AllowedAction>([
  'create_synthetic_user',
  'create_synthetic_tenant',
  'create_synthetic_record',
  'call_api_with_test_identity',
  'verify_denial',
]);

/** Explicit offline reason — quoted from the step file. */
const NO_AI_GAP_REASON =
  'active write-probe requires AI planning; re-run without --no-ai';

export interface RunPlanWalkerDeps {
  readonly registry: ToolRegistry;
  readonly policy: ValidationPolicy;
  readonly context: ToolContext;
  readonly artifactDir: string;
  readonly now?: () => number;
  /**
   * The deterministic floor (Step 35). Default returns no findings; the
   * plan-walker still concatenates one `coverage_gap` per registered
   * write-probe tool regardless of the floor's output.
   */
  readonly runFloor?: (
    facts: readonly NamedFact[],
    gaps: readonly LedgerGap[],
  ) => readonly Finding[];
}

const digestOf = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const errorClassOf = (cause: unknown): string =>
  cause instanceof Error ? cause.name : 'UnknownError';

function writeProbeCoverageGap(toolId: string): Finding {
  return {
    id: `plan-walker-no-ai-${toolId}`,
    control_id: 'cc-no-ai-write-probe',
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: `Write probe "${toolId}" not exercised under --no-ai`,
    summary: NO_AI_GAP_REASON,
    evidence_refs: [],
  };
}

/**
 * Run the deterministic plan-walker. Iterates the registered catalog in a
 * stable order (`Map` insertion order). For each tool: skip if write-probe →
 * `coverage_gap`; else gate → args-parse(empty) → invoke → result-parse-or-
 * reject → write. Same gate, same boundary, same floor as the AI loop.
 */
export async function runPlanWalker(
  deps: RunPlanWalkerDeps,
): Promise<AgenticLoopResult> {
  const now = deps.now ?? Date.now;
  const state = new ArtifactState({ artifactDir: deps.artifactDir });
  const ledger = new RequiredEvidenceLedger(deps.policy);
  const writeProbeGaps: Finding[] = [];

  // Stable iteration order over the registered catalog. The view does not
  // expose `invoke` — we resolve the full descriptor to call it.
  for (const view of deps.registry.descriptors()) {
    const tool = deps.registry.resolve(view.tool_id);
    if (tool === undefined) continue;

    if (WRITE_PROBE_ACTIONS.has(tool.required_action)) {
      // D5 honest-offline: don't invent a target; emit one gap, never call.
      writeProbeGaps.push(writeProbeCoverageGap(tool.tool_id));
      continue;
    }

    const gate = enforce(
      {
        serviceId: tool.tool_id,
        tool: tool.tool_id,
        action: tool.required_action,
      },
      deps.policy,
    );
    if (isErr(gate)) {
      state.recordDenial(tool.tool_id, gate.error.message);
      continue;
    }

    // No AI → empty args. A tool that requires fields will arg-reject here,
    // which the AI loop would also see if its driver omitted the field.
    const parsedArgs = tool.args_schema.safeParse({});
    if (!parsedArgs.success) {
      state.recordArgReject(tool.tool_id, 'plan-walker passes empty args');
      continue;
    }

    const t0 = now();
    let invokeResult;
    try {
      // codex p3-r2-003: mirror the agentic loop — thread the scan's
      // artifactDir into the ToolContext so artifact-producing tools (e.g.
      // supabase read-schema-meta writing database-metadata.json) can satisfy
      // §K ledger rows under --no-ai too.
      const toolContext: ToolContext = {
        ...deps.context,
        artifactDir: deps.artifactDir,
      };
      invokeResult = await tool.invoke(
        parsedArgs.data,
        toolContext,
        deps.policy,
      );
    } catch (cause) {
      state.recordToolError(tool.tool_id, errorClassOf(cause), now() - t0);
      continue;
    }
    if (isErr(invokeResult)) {
      state.recordToolError(tool.tool_id, invokeResult.error.name, now() - t0);
      continue;
    }

    const parsedResult = tool.result_schema.safeParse(invokeResult.value);
    if (!parsedResult.success) {
      state.recordToolResultReject(
        tool.tool_id,
        'result failed schema',
        now() - t0,
      );
      continue;
    }
    if (containsClassificationKey(parsedResult.data)) {
      state.recordToolResultReject(
        tool.tool_id,
        'result carried a classification key',
        now() - t0,
      );
      continue;
    }

    state.writeToolResult(
      tool.tool_id,
      parsedResult.data,
      digestOf(parsedResult.data),
      now() - t0,
    );
  }

  // Post-walk floor (same shape as the loop).
  state.recordDone();
  const ledgerMissing = ledger.missing(state);
  if (ledgerMissing.length > 0) {
    state.recordEarlyDone(ledgerMissing.map((g) => g.baseline_item_id));
  }
  const facts = state.collectAcceptedFacts();
  const runFloor = deps.runFloor ?? runClassificationPredicates;
  const floorFindings = runFloor(facts, ledgerMissing);
  const termination: LoopTermination =
    ledgerMissing.length > 0 ? 'early_done' : 'done';
  return {
    termination,
    findings: [...floorFindings, ...writeProbeGaps],
    facts,
    ledgerMissing,
    state,
  };
}
