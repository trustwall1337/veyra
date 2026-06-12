import { z } from 'zod';

import type { ToolDescriptor } from '../../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../../core/tools/descriptor.js';
import { asToolId } from '../../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../../types/tool-result.js';
import type { LovableClient } from '../client.js';

/**
 * Lovable MCP read tools (Phase 3 / Step 33). Only the READ subset of the
 * Phase 1 Lovable allowlist is exposed to the loop — `send_message` is
 * deliberately excluded (it is plan-mode messaging via fixed templates, not a
 * read-only evidence tool). Each `invoke` routes through `LovableClient.invoke`,
 * which re-checks the allowlist (defense-in-depth). No generic `call-mcp`.
 */

const LOVABLE_READ_METHODS: ReadonlyArray<{
  readonly method: string;
  readonly toolId: string;
}> = [
  { method: 'get_project', toolId: 'lovable-get-project' },
  { method: 'list_files', toolId: 'lovable-list-files' },
  { method: 'read_file', toolId: 'lovable-read-file' },
  { method: 'list_edits', toolId: 'lovable-list-edits' },
  { method: 'get_diff', toolId: 'lovable-get-diff' },
];

const passthroughArgs = z.record(z.string(), z.unknown());

/** Build one read tool per allowlisted Lovable read method. */
export function createLovableMcpTools(
  client: LovableClient,
): ReadonlyArray<ToolDescriptor<Record<string, unknown>, ToolResult>> {
  return LOVABLE_READ_METHODS.map(({ method, toolId }) => {
    const idResult = asToolId(toolId);
    if (isErr(idResult)) {
      throw new Error(`invalid lovable tool id: ${idResult.error.message}`);
    }
    return {
      tool_id: idResult.value,
      title: `Lovable MCP read: ${method}`,
      args_schema: passthroughArgs,
      result_schema: toolResultSchema,
      required_action: 'read_code',
      source_module: 'src/connectors/lovable/tools/index.ts',
      invoke: async (args) => {
        const response = await client.invoke(method, args);
        if (isErr(response)) {
          return err(
            new ToolInvocationError(
              `lovable ${method} failed: ${response.error.message}`,
            ),
          );
        }
        return ok({
          facts: [
            { name: 'lovable_method', value: method },
            {
              name: 'has_response',
              value: response.value !== null && response.value !== undefined,
            },
          ],
        });
      },
    };
  });
}
