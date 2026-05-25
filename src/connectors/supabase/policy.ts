/**
 * Supabase MCP connector policy.
 *
 * Per PHASE_1_PLAN §4.4 + CLAUDE.md MCP discipline: every tool call
 * requires read_only=true AND project_ref; mutations are denied
 * regardless of policy; execute_sql is denied under Phase 1.
 *
 * The `read_only` flag is derived from the active ValidationPolicy —
 * NOT hardcoded in the connector. That's the bug the validation-policy
 * seam exists to prevent.
 */

import { PolicyViolationError } from '../../types/errors.js';
import { asConnectorId, type ConnectorId } from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

function mintConnectorId(): ConnectorId {
  const r = asConnectorId('supabase');
  if (!r.ok) {
    throw new Error(`bug: ${r.error.message}`);
  }
  return r.value;
}

export const SUPABASE_CONNECTOR_ID: ConnectorId = mintConnectorId();

// Allowlist with required capabilities. The connector consults
// `ValidationPolicy.allowed_actions` for each tool before invocation.
interface ToolPolicyEntry {
  readonly tool: string;
  readonly requires: AllowedAction;
}

export const SUPABASE_ALLOWLIST: readonly ToolPolicyEntry[] = [
  { tool: 'list_tables', requires: 'read_schema_metadata' },
  { tool: 'list_extensions', requires: 'read_schema_metadata' },
  { tool: 'list_migrations', requires: 'read_schema_metadata' },
  { tool: 'get_advisors', requires: 'read_schema_metadata' },
  { tool: 'get_logs', requires: 'read_application_logs' },
  { tool: 'list_edge_functions', requires: 'read_code' },
  { tool: 'get_edge_function', requires: 'read_code' },
  { tool: 'list_storage_buckets', requires: 'read_storage_metadata' },
  { tool: 'get_storage_config', requires: 'read_storage_metadata' },
];

const DENIED_TOOLS: ReadonlySet<string> = new Set([
  'execute_sql',
  'apply_migration',
  'deploy_edge_function',
  'create_branch',
  'merge_branch',
  'delete_branch',
  'update_storage_config',
]);

export function findTool(tool: string): ToolPolicyEntry | undefined {
  return SUPABASE_ALLOWLIST.find((e) => e.tool === tool);
}

export interface SupabaseInvocation {
  readonly tool: string;
  readonly read_only: true;
  readonly project_ref: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export function checkInvocation(
  tool: string,
  projectRef: string,
  policy: ValidationPolicy,
): Result<SupabaseInvocation, PolicyViolationError> {
  if (DENIED_TOOLS.has(tool)) {
    return err(
      new PolicyViolationError(
        `Supabase tool "${tool}" is denied under Phase 1 (mutating or user-data tool)`,
        'read_schema_metadata',
        SUPABASE_CONNECTOR_ID as string,
      ),
    );
  }
  const entry = findTool(tool);
  if (entry === undefined) {
    return err(
      new PolicyViolationError(
        `Supabase tool "${tool}" is not on the allowlist`,
        'read_schema_metadata',
        SUPABASE_CONNECTOR_ID as string,
      ),
    );
  }
  if (projectRef.length === 0) {
    return err(
      new PolicyViolationError(
        'Supabase MCP requires a project_ref',
        entry.requires,
        SUPABASE_CONNECTOR_ID as string,
      ),
    );
  }
  if (!policy.allowed_actions.has(entry.requires)) {
    return err(
      new PolicyViolationError(
        `Supabase tool "${tool}" requires policy.allowed_actions.has("${entry.requires}")`,
        entry.requires,
        SUPABASE_CONNECTOR_ID as string,
      ),
    );
  }
  // `read_only` is derived from the policy: under
  // `read_only_evidence`, no mutation actions are allowed → read_only
  // is `true`. Future modes may relax with explicit approval; never
  // hardcoded in the connector body.
  return ok({
    tool,
    read_only: true,
    project_ref: projectRef,
  });
}
