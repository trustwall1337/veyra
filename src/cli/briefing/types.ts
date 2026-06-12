/**
 * Project briefing shape (Phase 3 / Step 40d). Pre-loop, AI-assisted (or
 * structural-only under `--no-ai`) synthesis of what the scanned app is,
 * which user roles it has, which database tables look sensitive, what
 * framework + key dependencies are in play, and where the trust
 * boundaries appear to be.
 *
 * The briefing is read-only orchestration metadata, never evidence: it
 * does NOT carry classification keys, does NOT become a Finding, does
 * NOT add a `control_id`, and does NOT relax any policy gate. The floor
 * remains the sole producer of classified Findings (PLAN §D.2).
 *
 * No closed unions on app type — `purpose.value: string` per FPP §2A so
 * Phase 4 sibling briefings (GitHub, Firebase) drop in as new leaf
 * folders without core-type edits.
 */

import type { SanitizedMessage } from '../../types/sanitized-message.js';

export type BriefingConfidence = 'low' | 'medium' | 'high';

/** Confidence-tagged scalar string (purpose, auth_model). */
export interface BriefingScalarField {
  readonly value: string;
  readonly confidence: BriefingConfidence;
  readonly uncertainty_notes?: string;
}

/** Confidence-tagged string list (user_roles, data_kinds, sensitive_tables, observed_trust_boundaries). */
export interface BriefingListField {
  readonly value: readonly string[];
  readonly confidence: BriefingConfidence;
  readonly uncertainty_notes?: string;
}

/** Dependency surface — structural in part (`framework`, `key_deps` from lockfile) + AI-confidence. */
export interface BriefingDependencySurface {
  readonly framework: string;
  readonly key_deps: readonly string[];
  readonly confidence: BriefingConfidence;
  readonly uncertainty_notes?: string;
}

/**
 * How the briefing was produced. Each value implies a different audit
 * footprint:
 *  - `ai_assisted`     — one Bedrock call, `model_id` + `prompt_fingerprint_sha256` populated.
 *  - `structural_only` — no AI call (`--no-ai` or budget=0); only inventory-derivable fields populated.
 *  - `degraded_fallback` — AI call attempted and failed; fields fall back to structural defaults.
 */
export type BriefingSynthesisMode =
  | 'ai_assisted'
  | 'structural_only'
  | 'degraded_fallback';

/** Project briefing — the LoopView's optional `briefing` field. */
export interface ProjectBriefing {
  readonly purpose: BriefingScalarField;
  readonly user_roles: BriefingListField;
  readonly data_kinds: BriefingListField;
  readonly auth_model: BriefingScalarField;
  readonly sensitive_tables: BriefingListField;
  readonly dependency_surface: BriefingDependencySurface;
  readonly observed_trust_boundaries: BriefingListField;
  readonly synthesis_mode: BriefingSynthesisMode;
  /** Bedrock model id; only present when `synthesis_mode === 'ai_assisted'`. */
  readonly model_id?: string;
  /** sha256 of the canonical prompt body; audit pointer, not a credential. */
  readonly prompt_fingerprint_sha256?: string;
  /** ISO-8601; normalized OUT of the digest computation so reruns are byte-identical. */
  readonly recorded_at: string;
}

/** Thrown / wrapped on every briefing failure surface. */
export class BriefingSynthesisError extends Error {
  override readonly name = 'BriefingSynthesisError';
  constructor(message: string, public readonly kind: BriefingErrorKind = 'unknown') {
    super(message);
  }
}

export type BriefingErrorKind =
  | 'ai_call_failed'
  | 'schema_violation'
  | 'classification_key_smuggled'
  | 'unknown_field'
  | 'budget_exhausted'
  | 'persist_failed'
  | 'inventory_unavailable'
  | 'unknown';

/**
 * The minimal Bedrock call surface the briefing synthesizer needs.
 * Independent of the loop's `BedrockTransport` (which is hardcoded to
 * the loop view + descriptor shape) — Decision C of step 40d. One
 * folder per service identity (FPP §2A); the live wiring is built in
 * `src/cli/scan-command.ts` over the same lazy-imported SDK as the
 * loop transport.
 */
export interface BriefingBedrockCaller {
  complete(req: BriefingBedrockRequest): Promise<BriefingBedrockResponse>;
}

export interface BriefingBedrockRequest {
  readonly model_id: string;
  readonly system: SanitizedMessage;
  readonly user: SanitizedMessage;
  readonly max_output_tokens: number;
  readonly response_schema: Readonly<Record<string, unknown>>;
}

export interface BriefingBedrockResponse {
  /** Parsed AI return; untrusted, re-validated by `validate.ts`. */
  readonly parsed_output: unknown;
  readonly model_id: string;
  readonly prompt_fingerprint_sha256?: string;
  /** Token-equivalent cost; debited to the loop budget. */
  readonly cost_units?: number;
}
