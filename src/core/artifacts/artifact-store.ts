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
 * Append-only artifact store on the local filesystem. One subdirectory per
 * scan id; one JSON file per ArtifactKind. The store refuses to overwrite
 * an existing artifact so the on-disk record is immutable for audit.
 */
export function createFsArtifactStore(rootDir: string): ArtifactStore {
  return {
    async write(scanId, kind, value) {
      const dir = path.join(rootDir, scanId);
      const file = path.join(dir, `${kind}.json`);
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
