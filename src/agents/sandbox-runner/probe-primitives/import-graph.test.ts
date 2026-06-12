import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Step 39b V9 — import-graph guard (codex 39b-007 [APPLIED]). The
 * sandbox-runner MUST NOT import `Finding` after 39b. `renderProbeFinding`
 * was relocated to `src/cli/floor-predicates.ts` and is the sole Finding
 * constructor for active-probe outcomes.
 */

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_RUNNER_DIR = path.dirname(THIS_DIR);

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

describe('V9 — sandbox-runner is Finding-free after 39b', () => {
  it('no file under src/agents/sandbox-runner/** imports Finding', async () => {
    const files = (await listTsFiles(SANDBOX_RUNNER_DIR)).filter(
      (p) => !p.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        if (src.includes('finding.js') || src.includes('finding.ts')) {
          throw new Error(
            `${file} imports "${src}" — sandbox-runner must stay Finding-free post-39b (V9 codex 39b-007 [APPLIED]).`,
          );
        }
      }
    }
  });
});
