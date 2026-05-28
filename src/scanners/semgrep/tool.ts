import { z } from 'zod';

import type { ToolDescriptor } from '../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../core/tools/descriptor.js';
import { asToolId } from '../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../types/tool-result.js';
import { scanFactsToToolResult } from '../scan-fact-tool-result.js';

import { runSemgrep } from './adapter.js';
import type { SemgrepRunner } from './types.js';

/** Tool id for the semgrep SAST scan; referenced by the §K ledger. */
export const RUN_SEMGREP_TOOL_ID = 'run-semgrep';

/**
 * Concrete leaf descriptor for the semgrep SAST scan (Phase 3 / Step 33). The
 * rules directory is injected at registration (the CLI bundles it). The
 * optional `runner` lets tests inject a fixture without the semgrep CLI.
 */
export function createSemgrepTool(opts: {
  readonly rulesPath: string;
  readonly runner?: SemgrepRunner;
}): ToolDescriptor<Record<string, never>, ToolResult> {
  const id = asToolId(RUN_SEMGREP_TOOL_ID);
  if (isErr(id)) throw new Error(`invalid tool id: ${id.error.message}`);
  return {
    tool_id: id.value,
    title: 'Run semgrep static analysis',
    args_schema: z.object({}),
    result_schema: toolResultSchema,
    required_action: 'read_code',
    source_module: 'src/scanners/semgrep/tool.ts',
    invoke: async (_args, context) => {
      const result = await runSemgrep(
        { projectPath: context.projectPath, rulesPath: opts.rulesPath },
        opts.runner,
      );
      if (isErr(result)) {
        return err(
          new ToolInvocationError(`semgrep scan failed: ${result.error.message}`),
        );
      }
      return ok(scanFactsToToolResult(result.value.facts));
    },
  };
}
