import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail per step 02c Done-When (extended per user direction to
 * cover all three new source files, not just types.ts + sanitization.ts):
 *
 *   "No file in `src/ai/types.ts`, `src/ai/sanitization.ts`, or
 *    `src/ai/prompt-injection-detector.ts` imports from any AI
 *    provider SDK."
 *
 * The point is to keep the provider-agnostic foundation truly
 * agnostic. The Anthropic SDK is allowed to land in step 02d, but only
 * inside `src/ai/providers/anthropic/` — not in the shared types,
 * sanitization helpers, or injection detector.
 */

const AI_DIR = path.dirname(fileURLToPath(import.meta.url));

// Anything new under `src/ai/` that is NOT a provider adapter must be
// added to this list. Provider adapters (e.g. `src/ai/providers/anthropic/`
// in step 02d) are EXPECTED to import their SDK and must NOT appear here.
// A future step may switch this to a directory walk that excludes
// `src/ai/providers/` once that subtree exists.
const GUARDED_FILES: readonly string[] = [
  'types.ts',
  'sanitization.ts',
  'prompt-injection-detector.ts',
];

const FORBIDDEN_IMPORT_SUBSTRINGS: readonly string[] = [
  '@anthropic-ai/sdk',
  '@anthropic-ai/',
  'openai',
  '@google-ai/',
  '@aws-sdk/',
  '@modelcontextprotocol/sdk',
];

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

describe('src/ai/ foundation has no provider SDK imports', () => {
  it.each(GUARDED_FILES)('%s imports no provider SDK', async (fileName) => {
    const full = path.join(AI_DIR, fileName);
    const content = await fs.readFile(full, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    const sources = extractImportSources(content);
    for (const src of sources) {
      for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
        if (src.includes(forbidden)) {
          throw new Error(
            `forbidden import in src/ai/${fileName}: "${src}" matches "${forbidden}"`,
          );
        }
      }
    }
  });
});
