/**
 * Lovable MCP connector policy.
 *
 * Per PHASE_1_PLAN §3 Step 1 + CLAUDE.md §MCP discipline: allowlist-only
 * design. Newly available Lovable tools are auto-denied because they
 * are not on this list. Adding one requires a code change + Phase-N
 * planning decision.
 */

import { PolicyViolationError } from '../../types/errors.js';
import { asConnectorId, type ConnectorId } from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';

import {
  TEMPLATE_AUTH_MODEL,
  TEMPLATE_DATA_HANDLING,
  TEMPLATE_PROJECT_OVERVIEW,
  TEMPLATE_USER_FLOWS,
  isAllowedTemplate,
} from './prompt-templates.js';

function mintConnectorId(): ConnectorId {
  const r = asConnectorId('lovable');
  if (!r.ok) {
    throw new Error(`bug: invalid hardcoded connector id: ${r.error.message}`);
  }
  return r.value;
}

export const LOVABLE_CONNECTOR_ID: ConnectorId = mintConnectorId();

export const ALLOWED_LOVABLE_TOOLS: ReadonlySet<string> = new Set([
  'get_project',
  'list_files',
  'read_file',
  'list_edits',
  'get_diff',
  'send_message',
]);

export interface SendMessageArgs {
  readonly template_id: string;
  readonly plan_mode: true;
  readonly slots?: Readonly<Record<string, string>>;
}

export function checkToolAllowed(
  tool: string,
): Result<void, PolicyViolationError> {
  if (!ALLOWED_LOVABLE_TOOLS.has(tool)) {
    return err(
      new PolicyViolationError(
        `Lovable tool "${tool}" is not on the Phase 1 allowlist`,
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  return ok(undefined);
}

// Retro-15 f3 + f4: strictly bound send_message inputs. Only the three
// explicit fields are permitted; any other top-level field is a
// caller attempting to smuggle free-form text past the template gate.
// Phase 1's four templates carry no slots, so slots is rejected unless
// a future template registers slot keys.
const SEND_MESSAGE_ALLOWED_KEYS = new Set(['template_id', 'plan_mode', 'slots']);

export function checkSendMessageArgs(
  args: unknown,
): Result<SendMessageArgs, PolicyViolationError> {
  if (typeof args !== 'object' || args === null) {
    return err(
      new PolicyViolationError(
        'send_message requires an args object',
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  const a = args as Record<string, unknown>;
  // Retro-15 f3: reject any field outside the explicit allowed set.
  // This blocks `message`, `prompt`, or other free-form text smuggling.
  for (const k of Object.keys(a)) {
    if (!SEND_MESSAGE_ALLOWED_KEYS.has(k)) {
      return err(
        new PolicyViolationError(
          `send_message rejected: unknown field "${k}"; only template_id + plan_mode (+ optional slots) are accepted`,
          'read_code',
          LOVABLE_CONNECTOR_ID as string,
        ),
      );
    }
  }
  if (a['plan_mode'] !== true) {
    return err(
      new PolicyViolationError(
        'send_message requires plan_mode: true',
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  if (typeof a['template_id'] !== 'string') {
    return err(
      new PolicyViolationError(
        'send_message requires a template_id (no free-form text)',
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  if (!isAllowedTemplate(a['template_id'])) {
    return err(
      new PolicyViolationError(
        `send_message template_id "${a['template_id']}" is not in the allowed set`,
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  // Retro-15 f4: slots are rejected for Phase 1. The four allowed
  // templates do not take slots. A future template adding slots must
  // declare its allowed slot keys + value schema and validate here.
  if (a['slots'] !== undefined) {
    return err(
      new PolicyViolationError(
        'send_message: slots are not accepted in Phase 1 (no template registers slot keys)',
        'read_code',
        LOVABLE_CONNECTOR_ID as string,
      ),
    );
  }
  return ok({
    template_id: a['template_id'],
    plan_mode: true,
  });
}

// Re-export template ids so callers can reference them by name.
export {
  TEMPLATE_AUTH_MODEL,
  TEMPLATE_DATA_HANDLING,
  TEMPLATE_PROJECT_OVERVIEW,
  TEMPLATE_USER_FLOWS,
};
