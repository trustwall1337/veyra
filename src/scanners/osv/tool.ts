import * as path from 'node:path';

import { z } from 'zod';

import type { ToolDescriptor } from '../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../core/tools/descriptor.js';
import { asToolId } from '../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../types/tool-result.js';
import { scanFactsToToolResult } from '../scan-fact-tool-result.js';

import { runOsv } from './adapter.js';
import type { OsvRunner } from './types.js';

/** Tool id for the OSV dependency scan; referenced by the §K ledger. */
export const RUN_OSV_TOOL_ID = 'run-osv';

/**
 * Concrete leaf descriptor for the OSV dependency scan (Phase 3 / Step 33).
 * The lockfile path is injected at registration (the CLI discovers it); the
 * args schema accepts an optional override. The optional `runner` lets tests
 * inject a fixture without the osv-scanner CLI.
 */
export function createOsvTool(
  opts: { readonly lockfilePath?: string; readonly runner?: OsvRunner } = {},
): ToolDescriptor<Record<string, never>, ToolResult> {
  const id = asToolId(RUN_OSV_TOOL_ID);
  if (isErr(id)) throw new Error(`invalid tool id: ${id.error.message}`);
  return {
    tool_id: id.value,
    title: 'Run OSV dependency vulnerability scan',
    args_schema: z.object({}),
    result_schema: toolResultSchema,
    required_action: 'read_code',
    source_module: 'src/scanners/osv/tool.ts',
    invoke: async (_args, context) => {
      // Lockfile path is injected at registration (the CLI discovers it);
      // the AI does not choose it. Defaults under the project root.
      const lockfilePath =
        opts.lockfilePath ??
        path.join(context.projectPath, 'package-lock.json');
      const result = await runOsv({ lockfilePath }, opts.runner);
      if (isErr(result)) {
        return err(
          new ToolInvocationError(`osv scan failed: ${result.error.message}`),
        );
      }
      return ok(scanFactsToToolResult(result.value.facts));
    },
  };
}
