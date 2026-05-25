import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  Artifact,
  ArtifactKind,
  ArtifactRef,
} from '../../types/artifact.js';
import { type Result, err, ok } from '../../types/result.js';

export class ArtifactStoreError extends Error {
  override readonly name = 'ArtifactStoreError';
}

export interface ArtifactStore {
  write<T>(
    scanId: string,
    kind: ArtifactKind,
    value: T,
  ): Promise<Result<ArtifactRef, ArtifactStoreError>>;
  read(
    ref: ArtifactRef,
  ): Promise<Result<Artifact<unknown>, ArtifactStoreError>>;
}

/**
 * Map an ArtifactKind to the on-disk basename. Phase 1 artifact
 * filenames in step files (FPP §9.3, revision §9 step-08-row) use
 * dashes, while TypeScript discriminator strings use underscores.
 * This mapping bridges the two without leaking provider names.
 */
function basenameFor(kind: ArtifactKind): string {
  switch (kind) {
    case 'scan_facts':
      return 'scan-facts.json';
    case 'control_cards':
      return 'control-cards.json';
    case 'declared_context':
      return 'declared-context.json';
    case 'evidence_inventory':
      return 'evidence-inventory.json';
    case 'veyra_report_md':
      return 'veyra-report.md';
    case 'veyra_report_json':
      return 'veyra-report.json';
  }
}

/**
 * Append-only artifact store on the local filesystem. One subdirectory per
 * scan id; one JSON file per ArtifactKind. The store refuses to overwrite
 * an existing artifact so the on-disk record is immutable for audit.
 */
export function createFsArtifactStore(rootDir: string): ArtifactStore {
  return {
    async write(scanId, kind, value) {
      const dir = path.join(rootDir, scanId);
      const file = path.join(dir, basenameFor(kind));
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (e) {
        return err(
          new ArtifactStoreError(`mkdir failed for ${dir}: ${String(e)}`),
        );
      }
      const payload: Artifact<unknown> = {
        ref: { scanId, kind, path: file },
        value,
        written_at: new Date().toISOString(),
      };
      try {
        await fs.writeFile(file, JSON.stringify(payload, null, 2), {
          flag: 'wx',
        });
      } catch (e) {
        return err(
          new ArtifactStoreError(
            `writeFile failed for ${file}: ${String(e)}`,
          ),
        );
      }
      return ok({ scanId, kind, path: file });
    },

    async read(ref) {
      try {
        const raw = await fs.readFile(ref.path, 'utf8');
        const parsed = JSON.parse(raw) as Artifact<unknown>;
        return ok(parsed);
      } catch (e) {
        return err(
          new ArtifactStoreError(
            `readFile failed for ${ref.path}: ${String(e)}`,
          ),
        );
      }
    },
  };
}
