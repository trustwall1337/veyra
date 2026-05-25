/**
 * Heuristic prompt-injection detector for AI output.
 *
 * Per AI-shape revision §5.3:
 *
 *   "If the AI structured output appears to follow instructions from
 *    project content (detected heuristically — e.g. the output mentions
 *    disabling sanitization, requests to drop the system prompt,
 *    requests for raw secrets), the inference run is rejected and the
 *    hypothesis batch is discarded."
 *
 * The detector is **heuristic, not policy**. It returns a structured
 * report (`suspected` flag + `reasons` tags). The caller — typically
 * `ContextPolicyEvaluator` — decides whether to discard the batch. This
 * separation keeps the detector inspectable: a future reviewer can see
 * exactly which patterns matched without re-running the regex set.
 *
 * Per step 02c user direction: the return shape is
 * `{ suspected: boolean, reasons: string[] }`, never a bare boolean.
 *
 * False positives are acceptable (block one legitimate batch). False
 * negatives fail-closed at the call site — the caller MUST discard on
 * `suspected: true`.
 */

interface PatternEntry {
  readonly tag: string;
  readonly pattern: RegExp;
}

const SUSPICIOUS_PATTERNS: readonly PatternEntry[] = [
  {
    tag: 'disable_sanitization',
    pattern: /\bdisable\s+(?:sanitization|redaction)\b/i,
  },
  {
    tag: 'reveal_secret',
    pattern: /\breveal\s+(?:the\s+)?(?:raw\s+)?(?:secret|key|credential)/i,
  },
  {
    tag: 'drop_system_prompt',
    pattern:
      /\b(?:ignore|drop|forget)\s+(?:the\s+)?(?:previous\s+|prior\s+)?(?:system\s+)?(?:prompt|instructions)/i,
  },
  {
    tag: 'persona_swap',
    pattern:
      /\b(?:act\s+as|pretend\s+to\s+be|you\s+are\s+now)\s+(?:a\s+)?(?:different|another)\s+(?:AI|model|assistant)/i,
  },
  {
    tag: 'execute_command',
    pattern: /\bexecute\s+the\s+following\s+(?:command|code|shell)/i,
  },
  {
    tag: 'override_safety',
    pattern: /\boverride\s+(?:your\s+)?(?:safety|guardrails|rules)/i,
  },
];

export interface PromptInjectionDetectionResult {
  readonly suspected: boolean;
  /**
   * Tags of every pattern that matched. Stable, machine-readable
   * identifiers (not user-facing prose). Empty when `suspected` is
   * false.
   */
  readonly reasons: readonly string[];
}

/**
 * Run the heuristic patterns against the given AI output. Returns a
 * structured report; the caller decides what to do with it.
 */
export function detectPromptInjection(
  aiOutput: string,
): PromptInjectionDetectionResult {
  const reasons: string[] = [];
  for (const entry of SUSPICIOUS_PATTERNS) {
    if (entry.pattern.test(aiOutput)) {
      reasons.push(entry.tag);
    }
  }
  return { suspected: reasons.length > 0, reasons };
}
