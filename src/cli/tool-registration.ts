import type { ToolRegistry } from '../core/tools/registry.js';
import { createReadCodeTool } from '../agents/product-understanding/tools/read-code.js';
import type { LovableClient } from '../connectors/lovable/client.js';
import { createLovableMcpTools } from '../connectors/lovable/tools/index.js';
import type { SupabaseClient } from '../connectors/supabase/client.js';
import { createSupabaseMcpTools } from '../connectors/supabase/tools/index.js';
import { createGitleaksTool } from '../scanners/gitleaks/tool.js';
import type { GitleaksRunner } from '../scanners/gitleaks/types.js';
import { createOsvTool } from '../scanners/osv/tool.js';
import type { OsvRunner } from '../scanners/osv/types.js';
import { createSemgrepTool } from '../scanners/semgrep/tool.js';
import type { SemgrepRunner } from '../scanners/semgrep/types.js';

/**
 * Non-core tool registration layer (Phase 3 / Step 33, PLAN §B placement rule).
 * Successor to `agent-registration.ts`: it imports the core registry CONTRACT
 * plus the concrete leaf descriptors, and wires them together. `src/core` never
 * imports a concrete tool — that keeps `no-cross-layer-imports` green.
 */

export interface ToolRunnersOverride {
  readonly gitleaks?: GitleaksRunner;
  readonly osv?: OsvRunner;
  readonly semgrep?: SemgrepRunner;
}

export interface ToolRegistrationOptions {
  /** Bundled Semgrep rules directory (the CLI supplies it). */
  readonly rulesPath: string;
  /** Discovered lockfile for OSV; omitted → OSV defaults under the project. */
  readonly lockfilePath?: string;
  /** Read-only Supabase MCP client; omitted → no Supabase tools registered. */
  readonly supabaseClient?: SupabaseClient;
  /** Lovable MCP client; omitted → no Lovable tools registered. */
  readonly lovableClient?: LovableClient;
  /** Test-only runner injection for the scanner tools. */
  readonly runners?: ToolRunnersOverride;
}

/** Register the read-only tool catalog the agentic loop / plan-walker calls. */
export function registerReadOnlyTools(
  registry: ToolRegistry,
  options: ToolRegistrationOptions,
): void {
  registry.register(
    createGitleaksTool(
      options.runners?.gitleaks !== undefined
        ? { runner: options.runners.gitleaks }
        : {},
    ),
  );
  registry.register(
    createOsvTool({
      ...(options.lockfilePath !== undefined
        ? { lockfilePath: options.lockfilePath }
        : {}),
      ...(options.runners?.osv !== undefined
        ? { runner: options.runners.osv }
        : {}),
    }),
  );
  registry.register(
    createSemgrepTool({
      rulesPath: options.rulesPath,
      ...(options.runners?.semgrep !== undefined
        ? { runner: options.runners.semgrep }
        : {}),
    }),
  );
  registry.register(createReadCodeTool());

  if (options.supabaseClient !== undefined) {
    for (const tool of createSupabaseMcpTools(options.supabaseClient)) {
      registry.register(tool);
    }
  }
  if (options.lovableClient !== undefined) {
    for (const tool of createLovableMcpTools(options.lovableClient)) {
      registry.register(tool);
    }
  }
}
