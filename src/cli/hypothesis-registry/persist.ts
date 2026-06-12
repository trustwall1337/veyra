/**
 * Hypothesis-registry persistence (Phase 3 / Step 40e Decision I).
 *
 * Writes `<artifactDir>/hypotheses.json` sibling to `project-briefing.json` +
 * `cleanup-proof.json` + `http-write-registry.json`. Empty snapshot still
 * produces an artifact (`{hypotheses: []}`) so V2 has a deterministic file
 * to assert against. Best-effort: a failed write logs once, returns
 * `Result.err`, scan continues.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { type Result, err, ok } from '../../types/result.js';

import type { LoopHypothesis } from './types.js';

export const HYPOTHESES_ARTIFACT_NAME = 'hypotheses.json';

export interface HypothesesArtifact {
  readonly hypotheses: readonly LoopHypothesis[];
}

export class HypothesisPersistError extends Error {
  override readonly name = 'HypothesisPersistError';
}

/** Persist the registry snapshot to `<artifactDir>/hypotheses.json`. */
export async function writeHypothesesArtifact(
  artifactDir: string,
  snapshot: readonly LoopHypothesis[],
): Promise<Result<string, HypothesisPersistError>> {
  const out = path.join(artifactDir, HYPOTHESES_ARTIFACT_NAME);
  const artifact: HypothesesArtifact = { hypotheses: snapshot };
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(out, JSON.stringify(artifact, null, 2), 'utf8');
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new HypothesisPersistError(`failed to write ${out}: ${m}`));
  }
}
