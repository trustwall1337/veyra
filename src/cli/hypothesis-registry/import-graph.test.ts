import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * V8 — Hypothesis-registry import-graph guard (PLAN §D.2 extension).
 *
 * The registry is metadata, NOT evidence. It MUST NOT import:
 *  - `Finding` from src/types/finding.js
 *  - `ScanFact` from src/types/scan-fact.js
 *  - any predicate module from src/agents/*\/predicates.ts
 *
 * Extends 40d V9 + 40c-v3 V13.
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

describe('hypothesis-registry: V8 import-graph guard', () => {
  it('no file imports Finding / ScanFact / agent predicates', async () => {
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
            `${file} imports "${src}" — hypothesis registry must not classify (PLAN §D.2 / V8).`,
          );
        }
        if (src.includes('scan-fact.js') || src.includes('scan-fact.ts')) {
          throw new Error(
            `${file} imports "${src}" — hypothesis-tool returns NO ScanFacts (Decision L / V3b).`,
          );
        }
        if (/\bagents\/[^/]+\/predicates\b/.test(src)) {
          throw new Error(
            `${file} imports a predicate module "${src}" — registry must not import floor predicates.`,
          );
        }
      }
    }
  });

  it('no file imports an AI provider SDK', async () => {
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
            `${file} imports "${src}" — hypothesis registry must remain SDK-agnostic.`,
          );
        }
      }
    }
  });
});

describe('V15 — FPP §2A: no closed unions on hint/ref fields', () => {
  it('LoopHypothesis.control_id_hint and briefing_field_ref are open strings', async () => {
    const typesPath = path.join(THIS_DIR, 'types.ts');
    const content = await fs.readFile(typesPath, 'utf8');
    expect(content).toMatch(/control_id_hint\?: string/);
    expect(content).toMatch(/briefing_field_ref\?: string/);
  });
});
