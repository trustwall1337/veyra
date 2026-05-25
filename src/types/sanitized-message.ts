/**
 * `SanitizedMessage` — a string that has passed through Veyra's
 * sanitization pipeline before being used in an AI prompt.
 *
 * Per AI-shape revision §5.2: sanitization runs twice (before artifact
 * storage AND before AI input). Producers that construct an AI prompt
 * must take a `SanitizedMessage`, never a raw `string`. The brand
 * prevents accidental leakage: assigning a raw string to a
 * `SanitizedMessage` parameter is a compile-time error.
 *
 * **There is no exported factory.** The brand is minted in exactly one
 * place — the sanitization helpers in `src/ai/sanitization.ts`. That is
 * the single chokepoint that has actually scrubbed the value. Exporting
 * an "easy raw constructor" here would make the brand decorative
 * (anyone could attach it to an unscrubbed string), which is the
 * pattern revision §5.2 forbids.
 */

export type SanitizedMessage = string & {
  readonly __brand: 'SanitizedMessage';
};
