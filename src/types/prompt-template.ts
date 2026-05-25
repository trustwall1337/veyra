/**
 * `PromptTemplateId` — an opaque identifier for one of the fixed prompt
 * templates Veyra ships.
 *
 * Per AI-shape revision §5.1: the `send_message_template` context
 * request kind accepts ONLY a `PromptTemplateId` — never free-form
 * text. The four current templates are listed in
 * `src/connectors/lovable/prompt-templates.ts` (Lovable allowlist):
 * `templates.project_overview`, `templates.user_flows`,
 * `templates.data_handling`, `templates.auth_model`.
 *
 * The brand prevents accidental free-form text reaching the
 * `send_message` connector path: assigning a raw `string` to a
 * `PromptTemplateId` parameter is a compile-time error.
 */

import { type Result, err, ok } from './result.js';

export type PromptTemplateId = string & {
  readonly __brand: 'PromptTemplateId';
};

export class InvalidPromptTemplateError extends Error {
  override readonly name = 'InvalidPromptTemplateError';
}

const TEMPLATE_ID_PATTERN = /^templates\.[a-z][a-z0-9_]*$/;

export function asPromptTemplateId(
  value: string,
): Result<PromptTemplateId, InvalidPromptTemplateError> {
  if (value.length === 0) {
    return err(
      new InvalidPromptTemplateError('PromptTemplateId cannot be empty'),
    );
  }
  if (!TEMPLATE_ID_PATTERN.test(value)) {
    return err(
      new InvalidPromptTemplateError(
        `PromptTemplateId must match ${TEMPLATE_ID_PATTERN.source}: got "${value}"`,
      ),
    );
  }
  return ok(value as PromptTemplateId);
}
