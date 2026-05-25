/**
 * AI Inference Agent shapes.
 *
 * Per revision §3.2 + §7.2: this agent produces `Hypothesis[]` only.
 * Never Findings, never AIConcerns. Output also includes optional
 * `ContextRequest[]` which the orchestrator routes through 08c's
 * `ContextPolicyEvaluator`.
 */

import type { AiProvider } from '../../ai/types.js';
import type { ContextRequest } from '../../types/context-request.js';
import type { Hypothesis } from '../../types/hypothesis.js';
import type { ScanFact } from '../../types/scan-fact.js';

export interface AiInferenceInput {
  readonly scanFacts: readonly ScanFact[];
  /** Free-form declared-context summary; the agent only reads it. */
  readonly declaredContext?: Readonly<Record<string, unknown>>;
  readonly provider: AiProvider;
  readonly model: string;
  readonly hypothesisBudget?: number;
  readonly maxOutputTokens?: number;
  /**
   * Optional callback for `scan-actions.log` rows
   * (`budget_exhausted`, `schema_violation`, etc.).
   */
  readonly actionLog?: (entry: AiInferenceLogEntry) => void;
}

export interface AiInferenceOutput {
  readonly hypotheses: readonly Hypothesis[];
  readonly contextRequests: readonly ContextRequest[];
  readonly budgetExhausted: boolean;
  readonly schemaViolations: number;
}

export type AiInferenceLogEntry =
  | { readonly event: 'budget_exhausted'; readonly cap: number }
  | { readonly event: 'schema_violation'; readonly attempt: number }
  | { readonly event: 'discarded_after_retries'; readonly attempts: number };
