import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Step 40d V9 — import-graph guard for the briefing module.
 *
 *   "src/cli/briefing/** does NOT import `Finding` from src/types/finding.ts."
 *
 * The briefing is metadata, not evidence. The floor remains the sole
 * `Finding` constructor (PLAN §D.2). Extends the 40c-v3 V13 guard so a
 * future briefing-related edit cannot silently start classifying.
 */

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

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

describe('briefing module: V9 import-graph guard', () => {
  it('no file under src/cli/briefing/ imports from src/types/finding.ts', async () => {
    const files = (await listTsFiles(THIS_DIR)).filter(
      (p) => !p.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        if (src.includes('finding.js') || src.includes('finding.ts')) {
          throw new Error(
            `briefing module ${file} imports "${src}" — the floor is the sole Finding constructor (PLAN §D.2). V9.`,
          );
        }
      }
    }
  });

  it('no file under src/cli/briefing/ imports an AI provider SDK', async () => {
    const files = await listTsFiles(THIS_DIR);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        if (
          src === '@anthropic-ai/sdk' ||
          src.startsWith('@anthropic-ai/') ||
          src === 'openai' ||
          src.startsWith('@modelcontextprotocol/sdk')
        ) {
          throw new Error(
            `briefing module ${file} imports "${src}" — briefing module must remain SDK-agnostic; live wiring lives in scan-command.ts.`,
          );
        }
      }
    }
  });
});
