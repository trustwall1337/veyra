import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type { ToolDescriptor } from '../../../core/tools/descriptor.js';
import { ToolInvocationError } from '../../../core/tools/descriptor.js';
import { asToolId } from '../../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../../types/result.js';
import { type ToolResult, toolResultSchema } from '../../../types/tool-result.js';
import type { SupabaseClient } from '../client.js';
import { SUPABASE_ALLOWLIST } from '../policy.js';

/**
 * Mechanically-derived Supabase MCP read tools (Phase 3 / Step 33, PLAN §D.5).
 * ONE descriptor per `SUPABASE_ALLOWLIST` entry — no generic `call-mcp`, and
 * because the allowlist excludes `DENIED_TOOLS`, `execute_sql` literally has no
 * descriptor (the AI cannot name it). Each `invoke` routes through
 * `SupabaseClient.invoke`, which injects `read_only=true` + `project_ref` and
 * re-checks the allowlist at invoke time (defense-in-depth).
 */

// Semantic renames for the two reads the §K ledger references; every other
// method falls back to its kebab-cased name.
const SEMANTIC_TOOL_ID: Readonly<Record<string, string>> = {
  list_tables: 'read-schema-meta',
  list_storage_buckets: 'read-storage-meta',
};

// codex p3-r1-007: §K ledger rows require a named artifact (`hasArtifact(...)`)
// in addition to `toolSucceeded(...)`. The supabase reads write the artifact
// on success so a Mode-A baseline can actually be satisfied end-to-end.
const ARTIFACT_BASENAME_BY_METHOD: Readonly<Record<string, string>> = {
  list_tables: 'database-metadata.json',
  list_storage_buckets: 'storage-metadata.json',
};

function toolIdForMethod(method: string): string {
  return SEMANTIC_TOOL_ID[method] ?? method.replace(/_/g, '-');
}

function mcpResponseToToolResult(method: string, response: unknown): ToolResult {
  // Minimal, safe mapping for Step 33: record that the read succeeded without
  // dumping the raw response (richer redacted mapping is a later step).
  return {
    facts: [
      { name: 'mcp_method', value: method },
      { name: 'has_response', value: response !== null && response !== undefined },
    ],
  };
}

/** Build one read tool per allowlisted Supabase MCP method. */
export function createSupabaseMcpTools(
  client: SupabaseClient,
): ReadonlyArray<ToolDescriptor<Record<string, never>, ToolResult>> {
  return SUPABASE_ALLOWLIST.map((entry) => {
    const idResult = asToolId(toolIdForMethod(entry.tool));
    if (isErr(idResult)) {
      throw new Error(`invalid supabase tool id: ${idResult.error.message}`);
    }
    return {
      tool_id: idResult.value,
      title: `Supabase MCP read: ${entry.tool} (read_only)`,
      args_schema: z.object({}),
      result_schema: toolResultSchema,
      required_action: entry.requires,
      source_module: 'src/connectors/supabase/tools/index.ts',
      invoke: async (_args, context) => {
        const response = await client.invoke(entry.tool);
        if (isErr(response)) {
          return err(
            new ToolInvocationError(
              `supabase ${entry.tool} failed: ${response.error.message}`,
            ),
          );
        }
        // codex p3-r1-007: write the §K-named artifact for methods the ledger
        // references. Best-effort: a write failure does not fail the tool
        // (the ledger will then mark the row missing). Non-secret metadata.
        const artifactBasename = ARTIFACT_BASENAME_BY_METHOD[entry.tool];
        if (artifactBasename !== undefined && context.artifactDir !== undefined) {
          try {
            await fs.mkdir(context.artifactDir, { recursive: true });
            await fs.writeFile(
              path.join(context.artifactDir, artifactBasename),
              JSON.stringify({ method: entry.tool, has_response: true }, null, 2),
              'utf8',
            );
          } catch {
            // intentionally swallowed — ledger row stays missing → coverage_gap
          }
        }
        return ok(mcpResponseToToolResult(entry.tool, response.value));
      },
    };
  });
}
