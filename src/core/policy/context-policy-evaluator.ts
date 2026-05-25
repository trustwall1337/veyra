/**
 * `ContextPolicyEvaluator` — the Phase 1 deterministic gatekeeper for AI
 * context requests.
 *
 * Per AI-shape revision §6.1:
 *
 *   "Gates AI context requests (§5). Deterministic. Implements the deny
 *    rules from §5.1, the sanitization order from §5.2, and the
 *    prompt-injection guard from §5.3. Returns sanitized `ScanFact[]` on
 *    grant; structured `ContextPolicyError` on deny. Owns retry-counting
 *    per scan; rejects after the configured cap (default 2)."
 *
 * This file is the **interface stub** only. The implementation lands in
 * step 02c. Splitting the interface into its own file lets downstream
 * agents type their dependencies today without waiting for the body.
 *
 * Constraints embedded in the type:
 *
 *  - The grant path produces `readonly ScanFact[]` — facts are the
 *    only currency that crosses the policy boundary (revision §8 #5,
 *    #7).
 *  - The denial path is a typed `ContextPolicyError`, never a raw
 *    `throw`, so callers can reason about why a request was rejected.
 */

import type { ContextRequest } from '../../types/context-request.js';
import type { Result } from '../../types/result.js';
import type { ScanFact } from '../../types/scan-fact.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

/**
 * Structured error for a denied or failed context request. Subtypes for
 * each deny rule (path on denylist, size cap exceeded, retry cap
 * exhausted, prompt-injection suspected) land with the implementation
 * in step 02c; today this base class is enough for downstream callers
 * to type their `Result` errors.
 */
export class ContextPolicyError extends Error {
  override readonly name = 'ContextPolicyError';
  public readonly request_id: string | undefined;

  constructor(message: string, request_id?: string, options?: ErrorOptions) {
    super(message, options);
    this.request_id = request_id;
  }
}

export interface ContextPolicyEvaluator {
  /**
   * Evaluate a single `ContextRequest` against the current
   * `ValidationPolicy`. On grant, returns the sanitized facts the
   * request produced. On deny, returns a typed error. Implementations
   * MUST run sanitization twice (storage + AI-input) per revision §5.2
   * and apply prompt-injection guards per §5.3.
   */
  evaluate(
    request: ContextRequest,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>>;
}
