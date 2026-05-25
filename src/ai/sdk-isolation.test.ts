import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Step 02d guardrail: `@anthropic-ai/sdk` may only be imported from
 * `src/ai/anthropic.ts`. No agent, scanner, connector, type module,
 * core module, or other AI helper may pull the SDK directly. Every
 * AI consumer goes through the `AiProvider` interface from
 * `src/ai/types.ts`.
 *
 * The test scans every `*.ts` file under `src/` and asserts the SDK
 * import string only appears in the allowed adapter file (and its
 * own test, which constructs a fake type-compatible client).
 */

const AI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(AI_DIR);

// `sdk-isolation.test.ts` mentions the SDK string only inside
// `FORBIDDEN_IMPORT_SUBSTRINGS` (data, not an import), so the current
// import-regex would not flag it. The entry below is conservative — if
// someone later refactors the substring list into a `from '@anthropic-ai/sdk'`
// re-export to keep the literal in one place, the allowlist still
// covers it.
const ALLOWED_FILES = new Set([
  path.join(AI_DIR, 'anthropic.ts'),
  path.join(AI_DIR, 'anthropic.test.ts'),
  path.join(AI_DIR, 'sdk-isolation.test.ts'),
]);

const FORBIDDEN_IMPORT_SUBSTRINGS: readonly string[] = [
  '@anthropic-ai/sdk',
  '@anthropic-ai/',
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
  const re = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const src = m[1] ?? m[2];
    if (src !== undefined) sources.push(src);
  }
  return sources;
}

describe('Anthropic SDK isolation', () => {
  it('only src/ai/anthropic.ts imports @anthropic-ai/sdk', async () => {
    const files = await listTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
          if (src.includes(forbidden)) {
            throw new Error(
              `forbidden Anthropic SDK import in ${file}: "${src}"`,
            );
          }
        }
      }
    }
  });

  it('the adapter file itself does import @anthropic-ai/sdk (sanity check)', async () => {
    const adapterPath = path.join(AI_DIR, 'anthropic.ts');
    const content = await fs.readFile(adapterPath, 'utf8');
    expect(content).toContain('@anthropic-ai/sdk');
  });
});
