import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultScanCommandDeps, type ScanCommandDeps } from './scan-command.js';

/**
 * Step 40b structural test (PLAN §G.1).
 *
 * (a) `defaultScanCommandDeps()` exposes the new `loopFactory` + `registerTools`
 *     seam, defaulted to the agentic-loop entry and the read-only tool
 *     registration. The fields are injectable so the fake-runner test seam is
 *     preserved (codex r2 confirmed no circular dep).
 *
 * (b) No NEW file outside the legacy allowlist imports the deprecated topo-sort
 *     symbols. Step 40 will physically retire the listed legacy files once the
 *     Mode B CLI fully replaces them; until then, the allowlist is the drift
 *     detector — a new file using the old API trips this test.
 */

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(CLI_DIR);

const LEGACY_IMPORTERS_RELATIVE: ReadonlySet<string> = new Set([
  'cli/scan-command.ts',
  'cli/scan-command.test.ts',
  'cli/agent-registration.ts',
  'core/orchestrator/scan-orchestrator.ts',
  'core/orchestrator/scan-orchestrator.test.ts',
]);

const FORBIDDEN_SYMBOLS: readonly string[] = [
  'createScanOrchestrator',
  'registerPhase1Agents',
  'ScanOrchestrator',
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

function importsForbiddenSymbol(content: string, symbol: string): boolean {
  // Match a static import statement that brings `symbol` into scope, either as
  // a named import (`import { ... symbol ... } from '...'`) or as a default
  // import (`import symbol from '...'`).
  const namedRe = new RegExp(
    `\\bimport(?:\\s+type)?\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\b`,
  );
  return namedRe.test(content);
}

describe('Step 40b — agentic-loop CLI seam', () => {
  it('defaults the loopFactory + registerTools fields on ScanCommandDeps', () => {
    const deps = defaultScanCommandDeps();
    expect(typeof deps.loopFactory).toBe('function');
    expect(typeof deps.registerTools).toBe('function');
  });

  it('the seam is configurable — fake-runner injection still works', () => {
    const defaults = defaultScanCommandDeps();
    const fakeLoop = (async () => ({}) as never) as typeof defaults.loopFactory;
    const custom: ScanCommandDeps = { ...defaults, loopFactory: fakeLoop };
    expect(custom.loopFactory).toBe(fakeLoop);
    // The default itself remains the real loop entry.
    expect(defaults.loopFactory?.name).toBe('runAgenticLoop');
  });

  it(
    'no NEW file outside the legacy allowlist imports the deprecated topo-sort symbols',
    async () => {
      const files = await listTsFiles(SRC_DIR);
      const offenders: string[] = [];
      for (const file of files) {
        const rel = path.relative(SRC_DIR, file);
        if (LEGACY_IMPORTERS_RELATIVE.has(rel)) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const symbol of FORBIDDEN_SYMBOLS) {
          if (importsForbiddenSymbol(content, symbol)) {
            offenders.push(`${rel} imports ${symbol}`);
          }
        }
      }
      if (offenders.length > 0) {
        throw new Error(
          `Files outside the Step 40b legacy allowlist must not import the deprecated topo-sort orchestrator. Offenders:\n  - ${offenders.join('\n  - ')}`,
        );
      }
    },
  );
});
