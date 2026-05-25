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
  const slots = a['slots'];
  return ok({
    template_id: a['template_id'],
    plan_mode: true,
    ...(typeof slots === 'object' && slots !== null
      ? { slots: slots as Readonly<Record<string, string>> }
      : {}),
  });
}

// Re-export template ids so callers can reference them by name.
export {
  TEMPLATE_AUTH_MODEL,
  TEMPLATE_DATA_HANDLING,
  TEMPLATE_PROJECT_OVERVIEW,
  TEMPLATE_USER_FLOWS,
};
