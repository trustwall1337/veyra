/**
 * 08b contract test: no producer writes `scanner-findings.json`
 * anywhere in the tree. The scan_facts ArtifactKind maps to the
 * basename `scan-facts.json` (dashes, plural-facts, per FPP §9.3 +
 * revision §9 step-08-row).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('08b clean-break: scanner-findings.json is no longer produced', () => {
  it('no .ts source under src/ writes `scanner-findings.json`', async () => {
    async function walk(dir: string, acc: string[]): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p, acc);
        else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) acc.push(p);
      }
      return acc;
    }
    const root = path.resolve(new URL('.', import.meta.url).pathname, '../../../src');
    const files = await walk(root, []);
    const hits: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      // Find references to the literal "scanner-findings.json" basename.
      // Skip historical references in comments that document the move.
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (!line.includes('scanner-findings.json')) continue;
        if (/^\s*(\/\/|\*)/.test(line)) continue; // comment
        // Test files name the legacy artifact as input fixture; that's allowed.
        if (file.endsWith('.test.ts')) continue;
        hits.push(`${file}: ${line.trim()}`);
      }
    }
    expect(hits, `forbidden references found:\n${hits.join('\n')}`).toEqual([]);
  });
});
