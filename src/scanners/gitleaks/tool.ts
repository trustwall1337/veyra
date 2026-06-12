import { z } from 'zod';

import type { ToolDescriptor } from '../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../core/tools/descriptor.js';
import { asToolId } from '../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../types/tool-result.js';
import { scanFactsToToolResult } from '../scan-fact-tool-result.js';

import { runGitleaks } from './adapter.js';
import type { GitleaksRunner } from './types.js';

/** Tool id for the gitleaks secret scan; referenced by the §K ledger. */
export const RUN_GITLEAKS_TOOL_ID = 'run-gitleaks';

/**
 * Concrete leaf descriptor for the gitleaks secret scan (Phase 3 / Step 33).
 * `--redact` is hard-bound inside the adapter (`buildGitleaksArgs`), NOT an
 * args-schema field — the AI can never turn redaction off (CLAUDE.md §Secrets).
 * The optional `runner` lets tests inject a fixture without the gitleaks CLI.
 */
export function createGitleaksTool(
  opts: { readonly runner?: GitleaksRunner } = {},
): ToolDescriptor<Record<string, never>, ToolResult> {
  const id = asToolId(RUN_GITLEAKS_TOOL_ID);
  if (isErr(id)) throw new Error(`invalid tool id: ${id.error.message}`);
  return {
    tool_id: id.value,
    title: 'Run gitleaks secret scan (redacted)',
    args_schema: z.object({}),
    result_schema: toolResultSchema,
    required_action: 'read_code',
    source_module: 'src/scanners/gitleaks/tool.ts',
    invoke: async (_args, context) => {
      const result = await runGitleaks(
        { projectPath: context.projectPath },
        opts.runner,
      );
      if (isErr(result)) {
        return err(
          new ToolInvocationError(`gitleaks scan failed: ${result.error.message}`),
        );
      }
      return ok(scanFactsToToolResult(result.value.facts));
    },
  };
}
