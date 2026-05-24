/**
 * PlaceholderService MCP connector.
 *
 * Collector only — no security reasoning. Every method routes through the
 * policy guard before invoking the MCP client. See CLAUDE.md §MCP discipline.
 */

import {
  enforceToolPolicy,
  PolicyViolationError,
} from '../../core/policy/tool-policy.js';
import { ok, err, type Result } from '../../types/result.js';

// Allowlisted tool names for this service.
// Source of truth: CLAUDE.md §MCP discipline.
// Keep this as a const array so it is grep-able and the type below stays narrow.
const ALLOWLIST = [
  // Lovable example: 'get_project', 'list_files', 'read_file', 'list_edits', 'get_diff', 'send_message'
  // Supabase: only methods that always pass read_only=true and a project_ref
] as const;

export type AllowedTool = (typeof ALLOWLIST)[number];

export class McpClientError extends Error {
  override readonly name = 'McpClientError';
}

export class PlaceholderServiceAuthError extends Error {
  override readonly name = 'PlaceholderServiceAuthError';
}

/**
 * Per-service config.
 *
 * Supabase note: this MUST include readonly `projectRef` and an always-true
 * `readOnly` flag — neither is optional.
 */
export interface PlaceholderServiceConnectorConfig {
  // TODO: fill per PHASE_1_PLAN §1 verified capabilities for this service.
}

export class PlaceholderServiceConnector {
  constructor(private readonly config: PlaceholderServiceConnectorConfig) {}

  // One typed method per allowlisted tool. Do NOT add a generic
  // call(tool, args) method — that defeats the allowlist.
  //
  // Example shape for a Lovable read tool:
  //
  //   async getProject(): Promise<
  //     Result<ProjectInfo, McpClientError | PolicyViolationError>
  //   > {
  //     const policy = enforceToolPolicy({
  //       service: 'placeholder-service',
  //       tool: 'get_project',
  //       args: {},
  //     });
  //     if (!policy.ok) return err(policy.error);
  //
  //     try {
  //       const response = await this.client.callTool('get_project', {});
  //       return ok(response as ProjectInfo);
  //     } catch (cause) {
  //       return err(
  //         new McpClientError('placeholder-service get_project failed', {
  //           cause: cause as Error,
  //         }),
  //       );
  //     }
  //   }
  //
  // Supabase note: every per-tool method must spread { readOnly: true,
  // projectRef: this.config.projectRef } into the args it sends.
}
