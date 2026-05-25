/**
 * Sanitization helpers for the AI subsystem.
 *
 * Per AI-shape revision §5.2:
 *
 *   "For every fulfilled context request, the evaluator runs
 *    sanitization twice with two different goals:
 *     1. Before artifact storage — store only the redacted form.
 *     2. Before AI input — re-apply sanitization on the redacted
 *        artifact when constructing the AI prompt."
 *
 * Both passes use these helpers. The functions are pure — no I/O, no
 * state — so the second pass is cheap to invoke.
 *
 * The `redactSecrets` below composes the existing scanner-side gitleaks
 * `redactSecrets` (which covers AWS/GCP/GitHub/Stripe/JWT shapes) with
 * AI-specific extra patterns (OpenAI keys, email, UUID, high-entropy
 * opaque tokens). The AI sanitization layer tilts toward false-positive
 * over false-negative — over-redacting a commit hash is better than
 * leaking an opaque token into a prompt.
 */

import { redactSecrets as gitleaksRedact } from '../scanners/gitleaks/parser.js';
import type { SanitizedMessage } from '../types/sanitized-message.js';

const REDACTED = 'REDACTED';

/**
 * Single chokepoint for minting a `SanitizedMessage`. Per step 02c user
 * direction: the brand has no exported factory in `src/types/`; values
 * become a `SanitizedMessage` only after passing through the two
 * scrubber passes in `redactSecrets` below. Keep this function private
 * — every call site must be inside this module.
 */
function brandAsSanitized(scrubbed: string): SanitizedMessage {
  return scrubbed as SanitizedMessage;
}

/**
 * Patterns the Gitleaks scanner rule set deliberately omits because
 * they over-match in scanner output. The AI prompt layer tilts the
 * other way — false positives are acceptable, false negatives leak
 * secrets into prompts.
 *
 * Each pattern is anchored on word boundaries where possible so long
 * narrative text is not eaten wholesale.
 */
const AI_EXTRA_PATTERNS: readonly RegExp[] = [
  // OpenAI API keys: legacy `sk-...` (≥20 trailing chars) and the
  // newer `sk-proj-...` project-key format.
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  // Email addresses. `\b` anchors avoid eating surrounding punctuation.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // UUID v1-v5 shape. Hex with the canonical dash positions.
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  // High-entropy opaque token: ≥40 base64-ish chars in a single run,
  // with optional `=` padding. Anchored on `\b` boundaries so a long
  // English sentence does not match. The 40-char floor is tuned to
  // avoid commit-hash collisions (40 hex chars sit at the floor — see
  // the "clean text" round-trip test).
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

/**
 * Two-pass redaction:
 *  1. Gitleaks scanner regex set (AWS, GCP, GitHub, Stripe, JWT) via
 *     `src/scanners/gitleaks/parser.ts`.
 *  2. AI-specific extras (OpenAI keys, email, UUID, high-entropy).
 *
 * Returns a `SanitizedMessage` brand. Callers that build an
 * `AiRequest` MUST pass values through this function before
 * constructing the message.
 */
export function redactSecrets(input: string): SanitizedMessage {
  let scrubbed = gitleaksRedact(input);
  for (const pattern of AI_EXTRA_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }
  return brandAsSanitized(scrubbed);
}

/**
 * Recursive PII / secret stripper for structured payloads. Walks the
 * value tree; redacts every string leaf via `redactSecrets`. Object
 * keys are preserved verbatim (key names are rarely secret-shaped and
 * losing them would break downstream JSON consumers).
 *
 * Returns `unknown` because the input shape is unconstrained; callers
 * narrow before consuming.
 */
export function stripRawData(record: unknown): unknown {
  if (record === null || record === undefined) return record;
  if (typeof record === 'string') {
    return redactSecrets(record);
  }
  if (typeof record === 'number' || typeof record === 'boolean') {
    return record;
  }
  if (Array.isArray(record)) {
    return record.map(stripRawData);
  }
  if (typeof record === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      out[key] = stripRawData(value);
    }
    return out;
  }
  // Functions, symbols, BigInt etc. — drop to a safe placeholder rather
  // than leaking implementation details into a prompt.
  return null;
}

/**
 * Wrap a sanitized excerpt with the `<observed_content>` delimiters per
 * revision §5.3 prompt-injection guard. The wrapper signals to the AI
 * system prompt that the content is project data, not instructions.
 *
 * **Guarantee:** any embedded `</observed_content>` closing tag inside
 * `content` is stripped before wrapping, so injected content cannot
 * **escape** the delimiter.
 *
 * **Not guaranteed:** nested-looking `<observed_content>` opening
 * substrings inside `content` are passed through verbatim. Defense
 * against opening-tag spoofing relies on (a) the system-prompt
 * contract that inner content is data, not instructions, and (b) the
 * `detectPromptInjection` heuristic that watches the AI's response.
 * The wrapper alone is not the defense.
 */
export function wrapAsObservedContent(
  content: SanitizedMessage,
  factId: string,
): string {
  const raw = content as string;
  const safe = raw.replace(/<\/observed_content>/gi, '');
  return `<observed_content fact_id="${factId}" sanitized="true">${safe}</observed_content>`;
}
