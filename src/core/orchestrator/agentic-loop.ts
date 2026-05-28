import { createHash } from 'node:crypto';

import { z } from 'zod';

import { type Redactor, createRedactor } from '../../ai/ai-output-redaction.js';
import type { Finding } from '../../types/finding.js';
import type { ProviderId } from '../../types/identity.js';
import { type Result, isErr } from '../../types/result.js';
import {
  type NamedFact,
  containsClassificationKey,
} from '../../types/tool-result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';
import {
  type SpawnDecision,
  authorizeSpawn as gateAuthorizeSpawn,
} from '../policy/spawn-gate.js';
import { enforce } from '../policy/tool-policy.js';
import {
  type SpawnDeepDiveProposal,
  type TargetDescriptor,
  targetDescriptorSchema,
} from '../tools/deep-dive.js';
import type { ToolContext, ToolDescriptorView } from '../tools/descriptor.js';
import type { ToolRegistry } from '../tools/registry.js';
import { type ToolId, asToolId } from '../tools/tool-id.js';

import {
  type ScopeError,
  deriveSubScope as defaultDeriveSubScopeImpl,
} from './derive-sub-scope.js';
import { runClassificationPredicates } from './floor.js';

import { ArtifactState, type LoopRecord, type LoopView } from './artifact-state.js';
import {
  type LoopTraceRow,
  type LoopTraceWriter,
  createLoopTraceWriter,
} from './loop-trace-writer.js';
import {
  type BudgetCaps,
  type BudgetLike,
  DEFAULT_BUDGET_CAPS,
  Budget,
} from './loop-budget.js';
import {
  type LedgerGap,
  RequiredEvidenceLedger,
} from './required-evidence-ledger.js';

/**
 * The agentic loop (Phase 3 / Agentic Veyra, PLAN §B). AI proposes → the
 * deterministic gate authorizes by `allowed_actions` → the tool runs inside a
 * per-tool try boundary → the result is parsed-or-rejected before it persists
 * or feeds the floor → repeat until a deterministic termination fires. This is
 * the runtime entry that replaces the topo-sort orchestrator (the old file is
 * migrated off by Step 40b, not deleted here). No provider SDK is imported:
 * {@link AiDriver} is an interface; the Bedrock provider is Step 31b.
 */

// ── AI driver / provider interfaces (provider-agnostic; no SDK here) ─────────

/** A concrete model provider; opaque id per FPP §2A. Fleshed out in Step 31b. */
export interface AiProvider {
  readonly id: ProviderId;
}

/** Envelope returned by the driver: the raw proposal + this call's cost. */
export interface AiProposalEnvelope {
  /** Untrusted; validated against {@link aiProposalSchema} before use. */
  readonly proposal: unknown;
  /** Token-equivalent cost of this call; debited from the budget. */
  readonly cost_units?: number;
  /** Optional model id (audit field §F). */
  readonly model_id?: string;
  /** Optional sha256 of the prompt sent for this proposal (audit field §F). */
  readonly prompt_fingerprint_sha256?: string;
}

/** What the loop calls each step. The concrete provider lives behind this. */
export interface AiDriver {
  proposeNext(
    view: LoopView,
    descriptors: readonly ToolDescriptorView[],
  ): Promise<AiProposalEnvelope>;
}

// ── Typed proposal union (validated before use — Verification a) ─────────────

export const aiProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('invoke_tool'),
    tool_id: z.string().min(1),
    args: z.unknown(),
  }),
  z.strictObject({ kind: z.literal('done') }),
  z.strictObject({
    kind: z.literal('spawn_deep_dive'),
    target_descriptor: targetDescriptorSchema,
  }),
]);

export type AiProposal = z.infer<typeof aiProposalSchema>;

// ── D6 seams (default impls land here; Step 31c hardens them) ────────────────

/**
 * The spawn gate seam. Step 31c provides the production `authorizeSpawn`
 * (`src/core/policy/spawn-gate.ts`): depth cap + typed-target validation +
 * policy check. The loop uses it as the default; callers may inject a stricter
 * gate for tests.
 */
export type AuthorizeSpawn = (input: {
  readonly proposal: SpawnDeepDiveProposal;
  readonly policy: ValidationPolicy;
  readonly depth: number;
}) => SpawnDecision;

const defaultAuthorizeSpawn: AuthorizeSpawn = gateAuthorizeSpawn;

/**
 * The sub-scope derivation seam. Step 31c provides the production
 * `deriveSubScope` (`src/core/orchestrator/derive-sub-scope.ts`): returns a
 * `Result` whose `err` covers empty / non-strict-subset cases. Failures are
 * recorded as `subagent_error` in the loop (the parent-side handling per §O).
 */
export type DeriveSubScope = (input: {
  readonly target: TargetDescriptor;
  readonly parentScope: ReadonlySet<ToolId>;
  readonly registry: ToolRegistry;
  readonly policy: ValidationPolicy;
}) => Result<ReadonlySet<ToolId>, ScopeError>;

const defaultDeriveSubScope: DeriveSubScope = defaultDeriveSubScopeImpl;

// ── Loop result + deps ───────────────────────────────────────────────────────

export type LoopTermination =
  | 'done'
  | 'early_done'
  | 'budget_halt'
  | 'stall_halt'
  | 'driver_error';

export interface AgenticLoopResult {
  readonly termination: LoopTermination;
  readonly findings: readonly Finding[];
  readonly facts: readonly NamedFact[];
  readonly ledgerMissing: readonly LedgerGap[];
  readonly state: ArtifactState;
}

export interface RunAgenticLoopDeps {
  readonly registry: ToolRegistry;
  readonly aiDriver: AiDriver;
  readonly policy: ValidationPolicy;
  readonly context: ToolContext;
  readonly artifactDir: string;
  readonly caps?: Partial<BudgetCaps>;
  readonly now?: () => number;
  /** Iterations without an accepted result before a stall-halt. Default 5. */
  readonly stallWindow?: number;
  /**
   * The deterministic floor (Step 35). Default returns no findings — Step 31
   * proves the floor is REACHED in every termination path, not what it emits.
   */
  readonly runFloor?: (
    facts: readonly NamedFact[],
    gaps: readonly LedgerGap[],
  ) => readonly Finding[];
  readonly authorizeSpawn?: AuthorizeSpawn;
  readonly deriveSubScope?: DeriveSubScope;
  /**
   * Stable-alias redactor (Step 34). Default = `createRedactor()`. Tool
   * results are redacted before re-entering the AI view and before any digest
   * lands in the audit trail.
   */
  readonly redactor?: Redactor;
  /**
   * `loop-trace.jsonl` writer (Step 34). Default writes to
   * `<artifactDir>/loop-trace.jsonl` durably per-step.
   */
  readonly traceWriter?: LoopTraceWriter;
}

const DEFAULT_STALL_WINDOW = 5;

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Run the agentic loop to a deterministic termination, then run the floor.
 * The floor runs in ALL termination paths (done / early_done / budget / stall /
 * driver-error).
 */
export async function runAgenticLoop(
  deps: RunAgenticLoopDeps,
): Promise<AgenticLoopResult> {
  const now = deps.now ?? Date.now;
  const stallWindow = deps.stallWindow ?? DEFAULT_STALL_WINDOW;
  const caps: BudgetCaps = { ...DEFAULT_BUDGET_CAPS, ...deps.caps };
  const authorizeSpawn = deps.authorizeSpawn ?? defaultAuthorizeSpawn;
  const deriveSubScope = deps.deriveSubScope ?? defaultDeriveSubScope;
  const runFloor = deps.runFloor ?? runClassificationPredicates;
  const redactor = deps.redactor ?? createRedactor();
  const traceWriter =
    deps.traceWriter ?? createLoopTraceWriter({ artifactDir: deps.artifactDir });

  const budget = new Budget(caps, now);
  const ledger = new RequiredEvidenceLedger(deps.policy);

  // ── Audit snapshots — computed once per scan, embedded in every trace row.
  const policyHash = digestOf(serializePolicy(deps.policy));
  const descriptorHash = digestOf(
    [...deps.registry.descriptors()]
      .map((d) => [String(d.tool_id), d.title].join(':'))
      .sort(),
  );

  // ── Per-iteration mutable snapshot — read by the `onRecord` hook.
  const snapshot: {
    viewDigest: string;
    modelId: string | undefined;
    promptFingerprint: string | undefined;
    subagentTarget: TargetDescriptor | undefined;
  } = {
    viewDigest: '',
    modelId: undefined,
    promptFingerprint: undefined,
    subagentTarget: undefined,
  };

  // Trace hook: one JSONL row per state record. Fire-and-forget; serialised
  // inside the writer so byte order is preserved.
  const onRecord = (record: LoopRecord): void => {
    void traceWriter.writeStep(mapRecordToTraceRow(record, snapshot, budget, {
      policyHash,
      descriptorHash,
    }));
  };

  const state = new ArtifactState({
    artifactDir: deps.artifactDir,
    onRecord,
  });

  const fullScope: ReadonlySet<ToolId> = new Set(
    deps.registry.descriptors().map((d) => d.tool_id),
  );

  // Termination is the PARENT loop's reason; only depth 0 sets it.
  const term: { value: LoopTermination | undefined } = { value: undefined };
  const setTermination = (reason: LoopTermination, depth: number): void => {
    if (depth === 0 && term.value === undefined) term.value = reason;
  };

  const runDeepDive = async (
    scope: ReadonlySet<ToolId>,
    childBudget: BudgetLike,
    depth: number,
    parentStep: number,
  ): Promise<void> => {
    let sinceProgress = 0;

    while (true) {
      const trip = childBudget.exceeded();
      if (trip !== undefined) {
        state.recordBudgetHalt(trip, depth);
        setTermination('budget_halt', depth);
        break;
      }
      if (sinceProgress >= stallWindow) {
        state.recordStallHalt(depth);
        setTermination('stall_halt', depth);
        break;
      }
      childBudget.countStep();

      let envelope: AiProposalEnvelope;
      try {
        const descriptors = deps.registry
          .descriptors()
          .filter((d) => scope.has(d.tool_id));
        // Redact the view BEFORE the AI sees it (Step 34 §D.4). The hash of the
        // redacted view is what the audit trail records — never the raw view.
        const redactedView = redactor.redact(state.readableView());
        snapshot.viewDigest = digestOf(redactedView);
        envelope = await deps.aiDriver.proposeNext(redactedView, descriptors);
      } catch (cause) {
        // codex p3-r1-008: a depth-1 driver failure must surface to the parent's
        // whole-call try as `subagent_error`, NOT silently halt as a driver
        // error inside the child. Re-throw so the parent's spawn catch records
        // `subagent_error` (the deep-dive target → §K coverage_gap via floor).
        if (depth > 0) throw cause;
        state.recordDriverError(errorClassOf(cause), depth);
        setTermination('driver_error', depth);
        break;
      }
      childBudget.addCost(envelope.cost_units ?? 0);
      snapshot.modelId = envelope.model_id;
      snapshot.promptFingerprint = envelope.prompt_fingerprint_sha256;

      const parsed = aiProposalSchema.safeParse(envelope.proposal);
      if (!parsed.success) {
        state.recordInvalidProposal('proposal failed schema validation', depth);
        sinceProgress += 1;
        continue;
      }
      const proposal = parsed.data;

      if (proposal.kind === 'done') {
        state.recordDone(depth);
        if (depth === 0 && !ledger.baselineSatisfied(state)) {
          state.recordEarlyDone(
            ledger.missing(state).map((g) => g.baseline_item_id),
            depth,
          );
          setTermination('early_done', depth);
        } else {
          setTermination('done', depth);
        }
        break;
      }

      if (proposal.kind === 'spawn_deep_dive') {
        childBudget.countToolCall();
        const acceptedBefore = state.collectAcceptedFacts().length;
        const subagentId = `subagent-${String(parentStep)}-${proposal.target_descriptor.kind}`;
        // Make the spawned target visible to any record fired in this iteration
        // (the spawn_denial / subagent_error / child-loop records).
        snapshot.subagentTarget = proposal.target_descriptor;
        // Parent-side WHOLE-CALL try/catch (codex r1 #1 / §O): a sub-agent can
        // fail OUTSIDE tool.invoke — a gate (authorizeSpawn) error, a
        // scope-derivation error, or a driver error inside the sub-loop. Any
        // escape → subagent_error; the floor (Step 35) turns it into a
        // coverage_gap; the parent continues. The depth cap (default
        // authorizeSpawn) denies depth >= 1, so spawning only occurs at depth 0
        // and the child budget is reserved from the root.
        try {
          const decision = authorizeSpawn({
            proposal,
            policy: deps.policy,
            depth,
          });
          if (!decision.allowed) {
            state.recordSpawnDenial(decision.reason, depth);
          } else {
            const subScopeResult = deriveSubScope({
              target: proposal.target_descriptor,
              parentScope: scope,
              registry: deps.registry,
              policy: deps.policy,
            });
            if (isErr(subScopeResult)) {
              // Scope-derivation error → §K coverage_gap via the floor.
              state.recordSubagentError(
                subagentId,
                subScopeResult.error.name,
                parentStep,
                depth,
              );
            } else {
              const subBudget = budget.reserveChild({});
              await runDeepDive(
                subScopeResult.value,
                subBudget,
                depth + 1,
                parentStep,
              );
            }
          }
        } catch (cause) {
          state.recordSubagentError(
            subagentId,
            errorClassOf(cause),
            parentStep,
            depth,
          );
        }
        // A deep-dive that recorded accepted facts is real progress — don't
        // let delegated spawns trip the parent stall-halt (review SHOULD #2).
        if (state.collectAcceptedFacts().length > acceptedBefore) {
          sinceProgress = 0;
        } else {
          sinceProgress += 1;
        }
        // Drop the spawn's target snapshot now that the iteration is done.
        snapshot.subagentTarget = undefined;
        continue;
      }

      // invoke_tool
      childBudget.countToolCall();
      const toolIdResult = asToolId(proposal.tool_id);
      if (isErr(toolIdResult)) {
        state.recordUnknownTool(proposal.tool_id, depth);
        sinceProgress += 1;
        continue;
      }
      const toolId = toolIdResult.value;
      if (!scope.has(toolId)) {
        state.recordOutOfScope(proposal.tool_id, depth);
        sinceProgress += 1;
        continue;
      }
      const tool = deps.registry.resolve(toolId);
      if (tool === undefined) {
        state.recordUnknownTool(proposal.tool_id, depth);
        sinceProgress += 1;
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
        state.recordDenial(tool.tool_id, gate.error.message, depth);
        sinceProgress += 1;
        continue;
      }

      const parsedArgs = tool.args_schema.safeParse(proposal.args);
      if (!parsedArgs.success) {
        state.recordArgReject(tool.tool_id, 'args failed schema', depth);
        sinceProgress += 1;
        continue;
      }

      const t0 = now();
      let invokeResult;
      try {
        // codex p3-r1-007: thread the scan's artifactDir into the ToolContext
        // so tools that produce a named artifact for the §K ledger (e.g.
        // `read-schema-meta` → `database-metadata.json`) can write it.
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
        // Per-tool failure boundary: a throw never rethrows or corrupts state.
        state.recordToolError(tool.tool_id, errorClassOf(cause), now() - t0, depth);
        sinceProgress += 1;
        continue;
      }
      if (isErr(invokeResult)) {
        state.recordToolError(
          tool.tool_id,
          invokeResult.error.name,
          now() - t0,
          depth,
        );
        sinceProgress += 1;
        continue;
      }

      // Result-parse-or-reject boundary (§D.1): parse BEFORE persist/floor.
      const parsedResult = tool.result_schema.safeParse(invokeResult.value);
      if (!parsedResult.success) {
        state.recordToolResultReject(
          tool.tool_id,
          'result failed schema',
          now() - t0,
          depth,
        );
        sinceProgress += 1;
        continue;
      }
      // Belt-and-suspenders: a classification key at any depth is rejected too.
      if (containsClassificationKey(parsedResult.data)) {
        state.recordToolResultReject(
          tool.tool_id,
          'result carried a classification key',
          now() - t0,
          depth,
        );
        sinceProgress += 1;
        continue;
      }

      // codex p3-r1-006: the audit-trail `result_digest` must hash the
      // REDACTED parsed result, never the raw invoke output (Step 34 §D.4).
      // The raw value is what the floor reads internally; the digest in the
      // trace is over the alias-mapped view.
      const redactedResult = redactor.redact(parsedResult.data);
      state.writeToolResult(
        tool.tool_id,
        parsedResult.data,
        digestOf(redactedResult),
        now() - t0,
        depth,
      );
      sinceProgress = 0;
    }
  };

  await runDeepDive(fullScope, budget, 0, 0);

  // Flush the audit trail before returning so the caller sees a complete file.
  await traceWriter.flush();

  // Floor ALWAYS runs (every termination path). It reads only accepted facts.
  const facts = state.collectAcceptedFacts();
  const ledgerMissing = ledger.missing(state);
  const findings = runFloor(facts, ledgerMissing);

  return {
    termination: term.value ?? 'done',
    findings,
    facts,
    ledgerMissing,
    state,
  };
}

function errorClassOf(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return 'UnknownError';
}

/** Stable JSON serialisation of the policy (sets → sorted arrays). */
function serializePolicy(policy: ValidationPolicy): string {
  return JSON.stringify({
    mode: policy.mode,
    environment: policy.environment,
    allowed_actions: [...policy.allowed_actions].sort(),
    forbidden_actions: [...policy.forbidden_actions].sort(),
    approval: policy.approval,
  });
}

/**
 * Map a {@link LoopRecord} to a §F-shaped {@link LoopTraceRow}, embedding the
 * per-scan snapshot hashes and the per-iteration mutable snapshot. Every field
 * is either populated, set to `'n_a'`, or left undefined — there is no raw
 * tool output or AI prompt in any field.
 */
function mapRecordToTraceRow(
  record: LoopRecord,
  snapshot: {
    readonly viewDigest: string;
    readonly modelId: string | undefined;
    readonly promptFingerprint: string | undefined;
    readonly subagentTarget: TargetDescriptor | undefined;
  },
  budget: { snapshot: () => import('./loop-budget.js').BudgetSnapshot },
  hashes: {
    readonly policyHash: string;
    readonly descriptorHash: string;
  },
): LoopTraceRow {
  const base: LoopTraceRow = {
    step: record.seq,
    recorded_at: new Date().toISOString(),
    depth: record.depth,
    gate_decision: 'n_a',
    arg_validation: 'n_a',
    result_validation: 'n_a',
    invoke_status: 'n_a',
    budget_snapshot: budget.snapshot(),
    policy_snapshot_hash: hashes.policyHash,
    descriptor_schema_version_hash: hashes.descriptorHash,
    state_view_digest: snapshot.viewDigest,
    parent_step: record.depth === 0 ? null : (record.parent_step ?? null),
    ...(snapshot.modelId !== undefined ? { model_id: snapshot.modelId } : {}),
    ...(snapshot.promptFingerprint !== undefined
      ? { prompt_fingerprint_sha256: snapshot.promptFingerprint }
      : {}),
    ...(record.subagent_id !== undefined
      ? { subagent_id: record.subagent_id }
      : {}),
    ...(snapshot.subagentTarget !== undefined
      ? { subagent_target: snapshot.subagentTarget }
      : {}),
    ...(record.depth === 0 || record.depth === 1
      ? { subagent_depth: record.depth as 0 | 1 }
      : {}),
  };

  switch (record.kind) {
    case 'tool_accepted':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'allow',
        arg_validation: 'accepted',
        result_validation: 'accepted',
        invoke_status: 'ok',
        ...(record.result_digest !== undefined
          ? { result_digest: record.result_digest }
          : {}),
        ...(record.duration_ms !== undefined
          ? { tool_duration_ms: record.duration_ms }
          : {}),
      };
    case 'denial':
    case 'out_of_scope':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'deny',
        ...(record.reason !== undefined
          ? { gate_reason: record.reason }
          : { gate_reason: record.kind }),
        invoke_status: 'denied',
      };
    case 'arg_reject':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'allow',
        arg_validation: 'rejected',
        invoke_status: 'rejected',
      };
    case 'tool_error':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'allow',
        arg_validation: 'accepted',
        invoke_status: 'error',
        ...(record.reason !== undefined
          ? { tool_error_class: record.reason }
          : {}),
        ...(record.duration_ms !== undefined
          ? { tool_duration_ms: record.duration_ms }
          : {}),
      };
    case 'tool_result_reject':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'allow',
        arg_validation: 'accepted',
        result_validation: 'rejected',
        ...(record.reason !== undefined
          ? { result_reject_reason: record.reason }
          : {}),
        invoke_status: 'rejected',
        ...(record.duration_ms !== undefined
          ? { tool_duration_ms: record.duration_ms }
          : {}),
      };
    case 'unknown_tool':
      return {
        ...base,
        proposal_kind: 'invoke_tool',
        ...(record.tool_id !== undefined ? { tool_id: record.tool_id } : {}),
        gate_decision: 'deny',
        gate_reason: 'unknown_tool',
        invoke_status: 'denied',
      };
    case 'invalid_proposal':
      return {
        ...base,
        proposal_kind: 'invalid',
        ...(record.reason !== undefined ? { gate_reason: record.reason } : {}),
      };
    case 'spawn_denial':
      return {
        ...base,
        proposal_kind: 'spawn_deep_dive',
        gate_decision: 'deny',
        ...(record.reason !== undefined ? { gate_reason: record.reason } : {}),
      };
    case 'subagent_error':
      return {
        ...base,
        proposal_kind: 'spawn_deep_dive',
        invoke_status: 'error',
        ...(record.reason !== undefined
          ? { tool_error_class: record.reason }
          : {}),
      };
    case 'done':
      return { ...base, proposal_kind: 'done' };
    case 'early_done':
      return {
        ...base,
        proposal_kind: 'done',
        gate_reason:
          record.missing !== undefined && record.missing.length > 0
            ? `unmet_baseline:${record.missing.join(',')}`
            : 'unmet_baseline',
      };
    case 'budget_halt':
      return {
        ...base,
        ...(record.reason !== undefined ? { gate_reason: record.reason } : {}),
      };
    case 'stall_halt':
      return { ...base, gate_reason: 'stall' };
    case 'driver_error':
      return {
        ...base,
        proposal_kind: 'driver_error',
        ...(record.reason !== undefined
          ? { tool_error_class: record.reason }
          : {}),
      };
  }
}
