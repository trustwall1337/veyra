import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type LovableTransport,
  createLovableClient,
} from '../connectors/lovable/client.js';
import {
  type SupabaseTransport,
  createSupabaseClient,
} from '../connectors/supabase/client.js';
import { createToolRegistry } from '../core/tools/registry.js';
import { registerReadOnlyTools } from './tool-registration.js';
import { defaultReadOnlyEvidencePolicy } from '../types/validation-policy.js';

/**
 * Verification (iii) of Phase 3 step 35: starting from every registered
 * concrete-tool entrypoint, the transitive TypeScript import graph never
 * reaches `src/types/finding.ts`. The AI can therefore not be in the call-tree
 * that constructs a `Finding`; only the post-loop deterministic floor can.
 *
 * codex p3-r1-002: the entrypoint set is DERIVED FROM THE REGISTRY (every
 * registered descriptor's `source_module`), not a hand-maintained list — so a
 * newly registered tool is automatically in scope.
 */

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(CLI_DIR);
const REPO_ROOT = path.dirname(SRC_DIR);
const FINDING_PATH = path.resolve(SRC_DIR, 'types/finding.ts');

// Fake transports used to build the registry without live MCP — they never
// run during the walk; we only collect `source_module` values.
const noopSupabaseTransport: SupabaseTransport = {
  invokeTool: async () => ({}),
};
const noopLovableTransport: LovableTransport = {
  invokeTool: async () => ({}),
};

function collectRegisteredEntrypoints(): readonly string[] {
  const reg = createToolRegistry();
  registerReadOnlyTools(reg, {
    rulesPath: '/bundled/rules',
    supabaseClient: createSupabaseClient({
      transport: noopSupabaseTransport,
      projectRef: 'p',
      policy: defaultReadOnlyEvidencePolicy('dev'),
    }),
    lovableClient: createLovableClient({
      transport: noopLovableTransport,
      projectId: 'p',
    }),
  });
  // Collect every registered tool's source_module via resolve() — the view
  // does not expose it.
  const sources = new Set<string>();
  for (const view of reg.descriptors()) {
    const desc = reg.resolve(view.tool_id);
    if (desc !== undefined) sources.add(desc.source_module);
  }
  return [...sources];
}

// Only real static `from '...'` specifiers — dynamic `import('...')` strings in
// JSDoc `@link` comments would otherwise be false-positive matches.
const IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|\s)\/\/[^\n]*/g;

function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT_RE, ' ').replace(LINE_COMMENT_RE, '$1');
}

function extractImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(stripped)) !== null) {
    const spec = m[1];
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

function resolveRelativeImport(
  importingFile: string,
  specifier: string,
): string | null {
  // Only follow same-package relative paths — external packages cannot reach
  // src/types/finding.ts by definition.
  if (!specifier.startsWith('.')) return null;
  const dir = path.dirname(importingFile);
  const base = path.resolve(dir, specifier);
  // NodeNext: TS sources use `.js` extensions for the future `.js` output.
  const candidates = [
    base.endsWith('.js') ? base.slice(0, -'.js'.length) + '.ts' : null,
    base.endsWith('.ts') ? base : null,
    !path.extname(base) ? `${base}.ts` : null,
    !path.extname(base) ? path.join(base, 'index.ts') : null,
  ].filter((c): c is string => c !== null);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function walkWithParents(entry: string): {
  reachable: Set<string>;
  parents: Map<string, string>;
} {
  const reachable = new Set<string>([entry]);
  const parents = new Map<string, string>();
  const stack: string[] = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of extractImportSpecifiers(content)) {
      const resolved = resolveRelativeImport(file, spec);
      if (resolved !== null && !reachable.has(resolved)) {
        reachable.add(resolved);
        parents.set(resolved, file);
        stack.push(resolved);
      }
    }
  }
  return { reachable, parents };
}

describe('Finding is unreachable from every registered tool entrypoint (Step 35 / §D.2(iii))', () => {
  const entrypoints = collectRegisteredEntrypoints();

  it('the registry derived a non-empty entrypoint set', () => {
    expect(entrypoints.length).toBeGreaterThan(0);
  });

  it('every registered entrypoint resolves to an existing source file', () => {
    for (const rel of entrypoints) {
      const abs = path.resolve(REPO_ROOT, rel);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it('no transitive import from a registered tool reaches src/types/finding.ts', () => {
    for (const rel of entrypoints) {
      const abs = path.resolve(REPO_ROOT, rel);
      const { reachable, parents } = walkWithParents(abs);
      if (reachable.has(FINDING_PATH)) {
        const chain: string[] = [];
        let cursor: string | undefined = FINDING_PATH;
        while (cursor !== undefined) {
          chain.unshift(path.relative(REPO_ROOT, cursor));
          cursor = parents.get(cursor);
        }
        throw new Error(
          `Finding is reachable from ${rel} via: ${chain.join(' -> ')}`,
        );
      }
    }
  });
});
