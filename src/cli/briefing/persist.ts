/**
 * Briefing artifact persistence + digest (Phase 3 / Step 40d).
 *
 *  - `writeBriefingArtifact` writes `<artifactDir>/project-briefing.json`.
 *  - `briefingDigest` computes sha256(canonical-JSON(briefing minus
 *    `recorded_at`)) — the wall-clock field is normalized OUT so reruns
 *    under the recorded Bedrock fixture produce a byte-identical digest
 *    (V1 + V4 determinism contract).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { err, ok, type Result } from '../../types/result.js';

import { BriefingSynthesisError, type ProjectBriefing } from './types.js';

export const PROJECT_BRIEFING_ARTIFACT_NAME = 'project-briefing.json';

/** Persist the briefing to `<artifactDir>/project-briefing.json`. */
export async function writeBriefingArtifact(
  artifactDir: string,
  briefing: ProjectBriefing,
): Promise<Result<string, BriefingSynthesisError>> {
  const out = path.join(artifactDir, PROJECT_BRIEFING_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(out, JSON.stringify(briefing, null, 2), 'utf8');
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new BriefingSynthesisError(`failed to write ${out}: ${m}`, 'persist_failed'));
  }
}

/**
 * sha256 over canonical-JSON(briefing minus `recorded_at`). Stable
 * across reruns even when the wall-clock changes.
 */
export function briefingDigest(briefing: ProjectBriefing): string {
  const { recorded_at: _omitted, ...rest } = briefing;
  void _omitted;
  return createHash('sha256').update(canonicalJsonString(rest)).digest('hex');
}

/** Deterministic JSON: keys sorted at every object level. */
function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortObjectKeysDeep(value));
}

function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortObjectKeysDeep(v));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortObjectKeysDeep(obj[k]);
    }
    return sorted;
  }
  return value;
}
