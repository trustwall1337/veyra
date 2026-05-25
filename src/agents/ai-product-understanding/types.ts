/**
 * AI Product-Understanding agent shapes.
 *
 * Per AI-shape revision §1 layer 1b + §7.1: this agent writes the
 * `declared_intent` field only — never `observed_evidence` (constraint 8).
 * The composer in `src/core/declared-context/` is the sole writer of
 * the final `declared-context.json`.
 */

export interface ConfidenceTaggedString {
  readonly value: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes?: string;
}

export interface ConfidenceTaggedStringList {
  readonly value: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes?: string;
}

export interface DeclaredIntent {
  readonly purpose?: ConfidenceTaggedString;
  readonly user_roles?: ConfidenceTaggedStringList;
  readonly data_kinds?: ConfidenceTaggedStringList;
  readonly auth_model?: ConfidenceTaggedString;
}

export interface AiDeclaredIntentArtifact {
  readonly declared_intent: DeclaredIntent;
  readonly model_id: string;
  readonly prompt_fingerprint_sha256: string;
  readonly observed_at: string;
}
