/**
 * Lovable local-git-clone CodeSource registration (step 28a).
 *
 * Marked `devOnly: false` — this is the Phase 1 customer-default path
 * for reading Lovable code (and any other local project). Step 28b
 * adds `lovable-mcp` as the OAuth-backed alternative once Lovable
 * endpoint / DCR / scope confirmations are recorded in `decisions.md`.
 */

import { asDataSourceId, type DataSourceId } from '../../types/data-sources.js';
import { registerDataSource } from '../registry.js';

import {
  createLovableGithubCloneCodeSource,
} from './code-source.js';

const LOVABLE_GITHUB_CLONE_ID: DataSourceId = (() => {
  const r = asDataSourceId('lovable-github-clone');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const lovableGithubCloneId: DataSourceId = LOVABLE_GITHUB_CLONE_ID;

export { createLovableGithubCloneCodeSource, walkPaths } from './code-source.js';
export type { CodeSourceFs, LovableGithubCloneCodeSourceOptions } from './code-source.js';
export {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_DEPTH,
  DIR_DENYLIST,
  PATH_PREFIX_DENYLIST,
  isExcludedPath,
} from './code-source.js';

export function registerLovableGithubClone(): void {
  registerDataSource({
    id: LOVABLE_GITHUB_CLONE_ID,
    label: 'local Lovable git clone',
    devOnly: false,
    code: ({ projectRoot, policy }) => {
      if (projectRoot === undefined) {
        throw new Error(
          'lovable-github-clone CodeSource requires projectRoot',
        );
      }
      return createLovableGithubCloneCodeSource({
        id: LOVABLE_GITHUB_CLONE_ID,
        projectRoot,
        policy,
      });
    },
  });
}
