import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail per step 02b Done-When:
 *
 *   "No file in `src/types/` or `src/core/` imports from `src/agents/`,
 *    `src/connectors/`, `src/scanners/`, or any AI provider SDK."
 *
 * The rule is the layering contract: types and core may not depend on
 * leaf modules. Violating it would let a downstream agent / connector /
 * scanner / AI provider SDK leak into the foundation surface, which is
 * exactly what `FPP §2A` extensibility rule 1 forbids.
 *
 * The test reads every `.ts` file under `src/types/` and `src/core/`
 * and asserts no import line contains a forbidden path or package.
 */

const TYPES_TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(TYPES_TEST_DIR);

const FORBIDDEN_IMPORT_SUBSTRINGS: readonly string[] = [
  // Internal layers that types/core may not reach into.
  '/agents/',
  '/connectors/',
  '/scanners/',
  // External AI provider SDKs. None of these should land in foundation
  // types — they live with the provider adapter (step 02d / Phase 2).
  '@anthropic-ai/sdk',
  '@anthropic-ai/',
  'openai',
  // MCP SDKs belong to connectors, not to foundation types.
  '@modelcontextprotocol/sdk',
];

async function listTsFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function extractImportSources(content: string): string[] {
  const sources: string[] = [];
  // Match `from '...'` and `from "..."` and dynamic `import('...')`.
  const re = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const src = m[1] ?? m[2];
    if (src !== undefined) sources.push(src);
  }
  return sources;
}

describe('foundation isolation: src/types/ and src/core/ have no cross-layer imports', () => {
  it('no file under src/types/ imports from agents/connectors/scanners/AI SDKs', async () => {
    const files = await listTsFiles(path.join(SRC_DIR, 'types'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
          if (src.includes(forbidden)) {
            throw new Error(
              `forbidden import in ${file}: "${src}" matches "${forbidden}"`,
            );
          }
        }
      }
    }
  });

  it('no file under src/core/ imports from agents/connectors/scanners/AI SDKs', async () => {
    const files = await listTsFiles(path.join(SRC_DIR, 'core'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
          if (src.includes(forbidden)) {
            throw new Error(
              `forbidden import in ${file}: "${src}" matches "${forbidden}"`,
            );
          }
        }
      }
    }
  });
});
