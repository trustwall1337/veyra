import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { redactSecrets } from '../../../ai/sanitization.js';
import type { ToolDescriptor } from '../../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../../core/tools/descriptor.js';
import { asToolId } from '../../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../../types/tool-result.js';

/** Tool id for the declared-surface file read; referenced by the §K ledger. */
export const READ_CODE_TOOL_ID = 'read-code';

/** Max bytes of file content returned as a fact (declared surface, not secret). */
const MAX_CONTENT_BYTES = 20_000;

// codex p3-r1-005: deny known secret-bearing paths outright. read-code returns
// declared SOURCE; an env / key / credential file isn't declared surface.
const SECRET_PATH_RE =
  /(?:^|\/)(\.env(\.[^/]+)?|.+\.pem|.+\.key|id_rsa(?:\.pub)?|\.npmrc|\.netrc|\.aws\/credentials|secrets?\.(json|ya?ml|toml))$/i;

// codex p3-r2-004: route file content through the existing `redactSecrets`
// sanitizer (AWS/GCP/GitHub/Stripe/JWT/OpenAI sk-proj keys / high-entropy
// opaque tokens) instead of an inline subset. The sanitizer's import chain
// stays Finding-free (gitleaks/parser → errors + result + gitleaks/types only),
// so the §D.2(iii) import-graph guard remains satisfied.

const readCodeArgs = z.object({ path: z.string().min(1) });

/**
 * Concrete leaf descriptor for reading one source file under the project root
 * (Phase 3 / Step 33; decomposed from the product-understanding agent). The
 * path is resolved against the project root and **path-traversal guarded** — a
 * path escaping the root is rejected, never read.
 */
export function createReadCodeTool(): ToolDescriptor<
  { readonly path: string },
  ToolResult
> {
  const id = asToolId(READ_CODE_TOOL_ID);
  if (isErr(id)) throw new Error(`invalid tool id: ${id.error.message}`);
  return {
    tool_id: id.value,
    title: 'Read one source file under the project root',
    args_schema: readCodeArgs,
    result_schema: toolResultSchema,
    required_action: 'read_code',
    source_module: 'src/agents/product-understanding/tools/read-code.ts',
    invoke: async (args, context) => {
      const resolved = path.resolve(context.projectPath, args.path);
      const rel = path.relative(context.projectPath, resolved);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        return err(
          new ToolInvocationError(
            `path escapes the project root and was not read: "${args.path}"`,
          ),
        );
      }
      // codex p3-r1-005: deny known secret-bearing paths outright.
      if (SECRET_PATH_RE.test(rel)) {
        return err(
          new ToolInvocationError(
            `secret-bearing path is not declared surface and was not read: "${rel}"`,
          ),
        );
      }
      try {
        const raw = await fs.readFile(resolved, 'utf8');
        // codex p3-r2-004: use the project's `redactSecrets` (composes gitleaks
        // patterns + AI-specific extras incl. OpenAI sk-proj + high-entropy
        // opaque tokens) instead of an inline subset.
        const sanitized = String(redactSecrets(raw));
        return ok({
          facts: [
            { name: 'path', value: rel },
            { name: 'bytes', value: raw.length },
            { name: 'content', value: sanitized.slice(0, MAX_CONTENT_BYTES) },
          ],
        });
      } catch (cause) {
        return err(
          new ToolInvocationError(
            `read failed for "${rel}": ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        );
      }
    },
  };
}
