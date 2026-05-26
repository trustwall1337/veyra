/**
 * Phase 2 scan-plan types (step 2.02).
 *
 * Plan types live in their own file because they have two distinct
 * producers (the AI security planner from step 2.07b and any
 * deterministic fallback) and one consumer (the
 * `ActiveValidationPolicyCompiler` from step 2.07c). The compiler is
 * producer-agnostic: it works on any well-typed plan, not just
 * AI-produced ones.
 *
 * Step 2.02 codex review pf2: the step file's literal
 * `generated_by: 'ai_security_planner' | 'deterministic_fallback'`
 * closed union put concrete agent names in shared types — exactly
 * the FPP §2A drift CLAUDE.md forbids. Replaced with an opaque
 * `producer_id: AnalyzerId`; concrete producer identity is a registry
 * concern, not a type concern.
 */

import type { AnalyzerId } from './identity.js';
import type { AllowedAction } from './validation-policy.js';
import type {
  ActiveValidationResult,
  ControlIdString,
} from './active-validation.js';

/**
 * Reference to the resource a test plan entry targets. Opaque shape;
 * each test type owns the meaning of `kind` + `ref` and validates them
 * at compile time. No closed union on `kind` here — new test types
 * register their own kinds without editing this file (FPP §2A).
 */
export interface TargetRef {
  /** Opaque discriminator owned by the producing test type. */
  readonly kind: string;
  /** Opaque reference string interpreted by the consuming executor. */
  readonly ref: string;
}

export interface ProposedScanPlanEntry {
  readonly test_id: string;
  readonly control_id: ControlIdString;
  readonly priority: 'low' | 'medium' | 'high';
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly justification: string;
}

/**
 * A plan proposed by some producer (AI planner, deterministic
 * fallback, human-authored). `producer_id` is an opaque `AnalyzerId`;
 * the compiler resolves it through the registry, never via a closed
 * union switch.
 */
export interface ProposedScanPlan {
  readonly scan_id: string;
  readonly producer_id: AnalyzerId;
  readonly entries: readonly ProposedScanPlanEntry[];
  readonly generated_at: string;
}

export interface CompiledScanPlanEntry extends ProposedScanPlanEntry {
  readonly validated_target_ref: TargetRef;
  readonly allowed_actions_satisfied: readonly AllowedAction[];
}

/**
 * A compiled plan: every entry has been validated against the catalog
 * and the active `ValidationPolicy`'s `allowed_actions`. The compiler
 * may also inject baseline test entries from the deterministic
 * fallback to ensure required-baseline-control coverage; those
 * injections are recorded in `baseline_injections`.
 */
export interface CompiledScanPlan {
  readonly scan_id: string;
  /** Opaque producer that the entries came from. */
  readonly source_producer_id: AnalyzerId;
  readonly entries: readonly CompiledScanPlanEntry[];
  readonly compiled_at: string;
  /** test_ids injected by the compiler from the deterministic baseline. */
  readonly baseline_injections: readonly string[];
}

/**
 * Compilation error shape. `rejected_entries` carries the entries the
 * compiler refused (with a human-readable reason); `missing_baseline_controls`
 * records baseline controls the producer omitted — note that missing
 * baseline is RECORDED for audit but does NOT cause rejection; the
 * compiler injects from the deterministic fallback in that case.
 */
export interface ActiveValidationCompilationError {
  readonly rejected_entries: readonly {
    readonly entry: ProposedScanPlanEntry;
    readonly reason: string;
  }[];
  readonly missing_baseline_controls: readonly ControlIdString[];
}

/**
 * Convenience re-exports so consumers can import plan + result types
 * from one place.
 */
export type { ActiveValidationResult };
