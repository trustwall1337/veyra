/**
 * `ActiveValidationPolicyCompiler` — the Phase 2 deterministic gate for
 * the executable scan plan.
 *
 * Per AI-shape revision §6.2:
 *
 *   "Gates the executable scan plan (§7 layer 6). Deterministic. Checks
 *    every entry's action is in `policy.allowed_actions`, every target
 *    exists in the project's known surface, every mandatory-baseline
 *    control has an entry (compiler injects if missing), and no entry
 *    exceeds the per-scan budget caps from `SyntheticDataPolicy`."
 *
 * This file is the **interface stub** only. The implementation lands in
 * Phase 2. Two separate stubs (this one + `ContextPolicyEvaluator`)
 * because the two policy components share zero code beyond the shared
 * `Result<T, E>` type — conflating them was the review caught in
 * revision §6.
 *
 * `ProposedScanPlan` and `CompiledScanPlan` are forward-declared
 * placeholder shapes — Phase 2 step files own their full definitions.
 * The placeholder shapes are deliberately opaque so this stub does not
 * leak Phase 2 design decisions back into Phase 1 foundation types.
 */

import type { Result } from '../../types/result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

/**
 * Placeholder — Phase 2 step files refine the shape. The `entries`
 * field is enough for the interface stub to compile against an
 * `entries.length` check today.
 */
export interface ProposedScanPlan {
  readonly entries: readonly unknown[];
}

/**
 * Placeholder — Phase 2 step files refine. Mirrors `ProposedScanPlan`
 * intentionally so the compile signature stays symmetric.
 */
export interface CompiledScanPlan {
  readonly entries: readonly unknown[];
}

/**
 * Structured error for a rejected plan. Phase 2 widens this with
 * subtypes per rejection reason (action not allowed, target unknown,
 * budget exceeded). Today it is enough for downstream callers to type
 * `Result<CompiledScanPlan, ActiveValidationCompilationError>`.
 */
export class ActiveValidationCompilationError extends Error {
  override readonly name = 'ActiveValidationCompilationError';
  public readonly rejected_entries: readonly unknown[];

  constructor(
    message: string,
    rejected_entries: readonly unknown[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.rejected_entries = rejected_entries;
  }
}

export interface ActiveValidationPolicyCompiler {
  /**
   * Validate a proposed plan and either compile it (with mandatory
   * baseline entries injected when missing) or reject it with a
   * structured error listing the offending entries.
   */
  compile(
    proposed: ProposedScanPlan,
    policy: ValidationPolicy,
  ): Promise<Result<CompiledScanPlan, ActiveValidationCompilationError>>;
}
