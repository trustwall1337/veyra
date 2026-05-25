import type { DeclaredIntent, ObservedEvidence } from '../../types/declared-context.js';

export interface BusinessLogicInput {
  /** Optional path to `declared-context.json`. */
  readonly declaredContextPath?: string;
  /** Inline declared context for tests. */
  readonly declaredContext?: {
    readonly observed_evidence?: Partial<ObservedEvidence>;
    readonly declared_intent?: DeclaredIntent;
  };
}

export interface BusinessLogicOutput {
  readonly findingsCount: number;
  readonly checklistEvaluated: number;
}
