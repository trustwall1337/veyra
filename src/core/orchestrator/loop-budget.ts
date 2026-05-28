/**
 * Agentic-loop budget (Phase 3 / Agentic Veyra, PLAN §E + `decisions.md` D3).
 *
 * Three independent caps plus a `max_steps` backstop, first-trips-wins. Every
 * tool attempt counts against `max_tool_calls` — denials, arg-rejects,
 * tool-errors, and result-rejects all count, so a misbehaving driver cannot
 * burn the loop indefinitely. {@link ChildBudget} is the D6 no-escape view: a
 * sub-agent's spend debits the SAME root counters and can never raise a cap.
 */

/** The four budget dimensions. */
export interface BudgetCaps {
  /** Max tool attempts (D3 = 40). Denials/rejects/errors count. */
  readonly max_tool_calls: number;
  /** Max wall-clock in ms (D3 = 5 min). */
  readonly max_wall_clock_ms: number;
  /**
   * Max AI cost in token-equivalent units (D3 = "a token cap, exact number
   * set at step-authoring time" → fixed here). Tunable via `--loop-budget`
   * (Step 40).
   */
  readonly max_ai_cost_units: number;
  /** Hard backstop on loop iterations. */
  readonly max_steps: number;
}

/** D3 defaults; the concrete `max_ai_cost_units` token value is fixed here. */
export const DEFAULT_BUDGET_CAPS: BudgetCaps = {
  max_tool_calls: 40,
  max_wall_clock_ms: 5 * 60 * 1000,
  max_ai_cost_units: 2_000_000,
  max_steps: 200,
};

/** Which cap tripped (for the `budget_halt` record). */
export type BudgetTrip =
  | 'max_tool_calls'
  | 'max_wall_clock_ms'
  | 'max_ai_cost_units'
  | 'max_steps';

/** Immutable snapshot for the audit trail (Step 34). */
export interface BudgetSnapshot {
  readonly tool_calls: number;
  readonly steps: number;
  readonly cost_units: number;
  readonly elapsed_ms: number;
  readonly caps: BudgetCaps;
}

/** What the loop needs from a budget — satisfied by both root and child. */
export interface BudgetLike {
  /** Returns the first tripped cap, or `undefined` if within budget. */
  exceeded(): BudgetTrip | undefined;
  /** Count one tool attempt (any outcome). */
  countToolCall(): void;
  /** Count one loop iteration. */
  countStep(): void;
  /** Add AI cost units (clamped to ≥ 0). */
  addCost(units: number): void;
  /** Snapshot for the trace. */
  snapshot(): BudgetSnapshot;
}

/** Remaining headroom across dimensions. */
export interface BudgetRemaining {
  readonly tool_calls: number;
  readonly cost_units: number;
  readonly steps: number;
  readonly wall_ms: number;
}

/** The single root budget for one scan. */
export class Budget implements BudgetLike {
  private toolCalls = 0;
  private steps = 0;
  private cost = 0;
  private readonly startedAt: number;

  constructor(
    private readonly caps: BudgetCaps,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  countToolCall(): void {
    this.toolCalls += 1;
  }

  countStep(): void {
    this.steps += 1;
  }

  addCost(units: number): void {
    this.cost += Math.max(0, units);
  }

  exceeded(): BudgetTrip | undefined {
    if (this.now() - this.startedAt >= this.caps.max_wall_clock_ms) {
      return 'max_wall_clock_ms';
    }
    if (this.toolCalls >= this.caps.max_tool_calls) return 'max_tool_calls';
    if (this.cost >= this.caps.max_ai_cost_units) return 'max_ai_cost_units';
    if (this.steps >= this.caps.max_steps) return 'max_steps';
    return undefined;
  }

  /** Root-counter getters used by {@link ChildBudget} to derive child spend. */
  get toolCallsSpent(): number {
    return this.toolCalls;
  }
  get costSpent(): number {
    return this.cost;
  }
  get stepsSpent(): number {
    return this.steps;
  }

  remaining(): BudgetRemaining {
    return {
      tool_calls: Math.max(0, this.caps.max_tool_calls - this.toolCalls),
      cost_units: Math.max(0, this.caps.max_ai_cost_units - this.cost),
      steps: Math.max(0, this.caps.max_steps - this.steps),
      wall_ms: Math.max(0, this.caps.max_wall_clock_ms - (this.now() - this.startedAt)),
    };
  }

  /**
   * D6 reserveChild: returns a {@link ChildBudget} whose slice is clamped to
   * the root's remaining headroom. The child cannot raise any cap.
   */
  reserveChild(requestedSlice: Partial<BudgetCaps>): ChildBudget {
    return new ChildBudget(this, requestedSlice, this.now);
  }

  snapshot(): BudgetSnapshot {
    return {
      tool_calls: this.toolCalls,
      steps: this.steps,
      cost_units: this.cost,
      elapsed_ms: this.now() - this.startedAt,
      caps: this.caps,
    };
  }
}

/**
 * D6 no-escape budget view for a deep-dive sub-agent. It holds NO independent
 * mutable counter — child spend is derived from root-counter deltas, so it
 * cannot be reset or forgotten. Every `count*`/`addCost` delegates to the root,
 * so sub-agent spend debits the root across ALL dimensions. The child's slice
 * is clamped to the root's remaining headroom at reservation time, so a child
 * can END the scan but never EXTEND it.
 */
export class ChildBudget implements BudgetLike {
  private readonly startToolCalls: number;
  private readonly startCost: number;
  private readonly startSteps: number;
  private readonly startedAt: number;
  private readonly sliceToolCalls: number;
  private readonly sliceCost: number;
  private readonly sliceSteps: number;
  private readonly sliceWallMs: number;

  constructor(
    private readonly root: Budget,
    requestedSlice: Partial<BudgetCaps>,
    private readonly now: () => number,
  ) {
    this.startToolCalls = root.toolCallsSpent;
    this.startCost = root.costSpent;
    this.startSteps = root.stepsSpent;
    this.startedAt = now();
    const rem = root.remaining();
    // Clamp every requested dimension to the root's remaining headroom: a
    // child can never request more than the root has left.
    this.sliceToolCalls = Math.min(
      requestedSlice.max_tool_calls ?? rem.tool_calls,
      rem.tool_calls,
    );
    this.sliceCost = Math.min(
      requestedSlice.max_ai_cost_units ?? rem.cost_units,
      rem.cost_units,
    );
    this.sliceSteps = Math.min(
      requestedSlice.max_steps ?? rem.steps,
      rem.steps,
    );
    this.sliceWallMs = Math.min(
      requestedSlice.max_wall_clock_ms ?? rem.wall_ms,
      rem.wall_ms,
    );
  }

  countToolCall(): void {
    this.root.countToolCall();
  }
  countStep(): void {
    this.root.countStep();
  }
  addCost(units: number): void {
    this.root.addCost(units);
  }

  exceeded(): BudgetTrip | undefined {
    // Root caps always win first — a child can end the scan when the root is
    // exhausted, regardless of its own slice.
    const rootTrip = this.root.exceeded();
    if (rootTrip !== undefined) return rootTrip;
    // Child slice: derived from root deltas, no independent counter.
    if (this.root.toolCallsSpent - this.startToolCalls >= this.sliceToolCalls) {
      return 'max_tool_calls';
    }
    if (this.root.costSpent - this.startCost >= this.sliceCost) {
      return 'max_ai_cost_units';
    }
    if (this.root.stepsSpent - this.startSteps >= this.sliceSteps) {
      return 'max_steps';
    }
    if (this.now() - this.startedAt >= this.sliceWallMs) {
      return 'max_wall_clock_ms';
    }
    return undefined;
  }

  snapshot(): BudgetSnapshot {
    return this.root.snapshot();
  }
}
