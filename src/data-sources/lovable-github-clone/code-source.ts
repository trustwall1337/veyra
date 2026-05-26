/**
 * Lovable local-git-clone CodeSource (step 28a).
 *
 * Reads code from a local directory the customer cloned with `git clone`
 * against their Lovable project's GitHub repo (step 27's documented
 * Phase 1 path). Implements `src/types/data-sources.ts CodeSource` so
 * the bootstrap composer and future code-aware agents consume one
 * uniform seam.
 *
 * Step 28a extracts this from `src/agents/product-understanding/
 * inventory/bootstrap.ts` — the file-walk lived inline there until
 * now, which step 27 incorrectly claimed already lived in
 * `src/data-sources/lovable-github-clone/`. The logic is moved
 * verbatim with the same denylists and depth/count caps; the bootstrap
 * composer is updated to consume this CodeSource.
 *
 * Step 28b will add the OAuth-backed `lovable-mcp` CodeSource. With
 * both behind the same interface, the registry resolves which one
 * runs without any branch in shared code.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  DataSourceError,
  type CodeSource,
  type DataSourceId,
  type FileWalkEntry,
  type FileWalkResult,
} from '../../types/data-sources.js';
import { err, ok, type Result } from '../../types/result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

export const DEFAULT_MAX_FILES = 5000;
export const DEFAULT_MAX_DEPTH = 8;

/**
 * Directory names skipped at any depth. These match the denylist that
 * lived inline in `bootstrap.ts` before step 28a. Step 26 Piece 3 added
 * `.veyra` so Veyra's own scan output directory is skipped on repeat
 * scans against the same project root.
 */
export const DIR_DENYLIST: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  '.git',
  '.vercel',
  '.cache',
  '.veyra',
];

/**
 * Path-prefix exclusions (segments not at the leaf). `supabase/.temp/`
 * is the Supabase CLI's temp-metadata directory; tool-internal, not
 * customer code.
 */
export const PATH_PREFIX_DENYLIST: readonly string[] = ['supabase/.temp'];

export function isExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  return PATH_PREFIX_DENYLIST.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/**
 * Injectable filesystem surface for tests. Mirrors the
 * `BootstrapFs` shape in bootstrap.ts so the two paths share fakes.
 * The default implementation uses `node:fs`.
 *
 * Step 28a codex df2: `lstat` and `realpath` were added so the walk
 * can detect and refuse symlinks pointing outside the declared
 * project root. The previous inline walk in bootstrap.ts used `stat`
 * (which follows symlinks) — fine when the customer trusts their
 * clone, but a defense-in-depth gap on a hardened CodeSource.
 * `lstat` and `realpath` are optional in the interface for back-compat
 * with the BootstrapFs fake; production uses `node:fs` which has both.
 */
export interface CodeSourceFs {
  readDir(p: string): Promise<readonly string[]>;
  stat(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  lstat?(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath?(p: string): Promise<string>;
  readFile(p: string, encoding: 'utf8'): Promise<string>;
}

const DEFAULT_FS: CodeSourceFs = {
  readDir: (p) => fs.readdir(p),
  stat: (p) => fs.stat(p),
  lstat: (p) => fs.lstat(p),
  realpath: (p) => fs.realpath(p),
  readFile: (p, enc) => fs.readFile(p, enc),
};

export interface LovableGithubCloneCodeSourceOptions {
  readonly id: DataSourceId;
  readonly projectRoot: string;
  readonly policy: ValidationPolicy;
  readonly maxFiles?: number;
  readonly maxDepth?: number;
  /** Test seam — production callers leave undefined. */
  readonly fs?: CodeSourceFs;
}

/**
 * Construct a CodeSource that walks the local project root and
 * reads files from disk. Capability-gated on `read_code` per the
 * existing union in `src/types/data-sources.ts`. Without the
 * capability, both `walk()` and `readFile()` short-circuit to
 * `capability_denied` before any I/O.
 */
export function createLovableGithubCloneCodeSource(
  options: LovableGithubCloneCodeSourceOptions,
): CodeSource {
  const io = options.fs ?? DEFAULT_FS;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const root = options.projectRoot;
  const policy = options.policy;

  return {
    id: options.id,
    async walk(): Promise<Result<FileWalkResult, DataSourceError>> {
      if (!policy.allowed_actions.has('read_code')) {
        return err(
          new DataSourceError(
            'capability_denied',
            'lovable-github-clone walk requires read_code capability; not in policy.allowed_actions',
          ),
        );
      }
      try {
        const entries = await walkInternal(io, root, maxFiles, maxDepth);
        return ok({ root, entries });
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        return err(new DataSourceError('transport_error', `file walk failed: ${m}`, cause));
      }
    },
    async readFile(relPath: string): Promise<Result<string, DataSourceError>> {
      if (!policy.allowed_actions.has('read_code')) {
        return err(
          new DataSourceError(
            'capability_denied',
            'lovable-github-clone readFile requires read_code capability; not in policy.allowed_actions',
          ),
        );
      }
      const absolute = path.resolve(root, relPath);
      const rootAbs = path.resolve(root);
      // Defense against path-traversal: lexical check first.
      if (!absolute.startsWith(rootAbs + path.sep) && absolute !== rootAbs) {
        return err(
          new DataSourceError(
            'capability_denied',
            `lovable-github-clone readFile path "${relPath}" escapes project root`,
          ),
        );
      }
      // Step 28a codex df2: symlink defense. The lexical check above
      // catches `../`-shaped escapes; this catches a symlink inside
      // the clone pointing OUTSIDE the clone. We compare realpath
      // against the realpath of the root so the check survives
      // symlinks that resolve to legitimate sibling directories the
      // customer's clone setup created.
      if (io.realpath !== undefined) {
        try {
          const realAbs = await io.realpath(absolute);
          const realRoot = await io.realpath(rootAbs);
          if (!realAbs.startsWith(realRoot + path.sep) && realAbs !== realRoot) {
            return err(
              new DataSourceError(
                'capability_denied',
                `lovable-github-clone readFile path "${relPath}" resolves via symlink outside project root`,
              ),
            );
          }
        } catch {
          // realpath failure (e.g. nonexistent path) falls through to
          // readFile, which will surface ENOENT.
        }
      }
      try {
        const text = await io.readFile(absolute, 'utf8');
        return ok(text);
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        return err(new DataSourceError('transport_error', `readFile failed for "${relPath}": ${m}`, cause));
      }
    },
  };
}

/**
 * Internal walk. Behavior is identical to the previous inline walk in
 * `bootstrap.ts` so the bootstrap regression tests stay green when
 * the composer delegates here.
 */
async function walkInternal(
  io: CodeSourceFs,
  root: string,
  maxFiles: number,
  maxDepth: number,
): Promise<readonly FileWalkEntry[]> {
  const out: FileWalkEntry[] = [];
  async function recurse(absolute: string, depth: number): Promise<void> {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries: readonly string[];
    try {
      entries = await io.readDir(absolute);
    } catch {
      return;
    }
    for (const name of entries) {
      if (DIR_DENYLIST.includes(name)) continue;
      const full = path.join(absolute, name);
      const rel = path.relative(root, full);
      if (isExcludedPath(rel)) continue;
      // Step 28a codex df2: use lstat so we can detect symlinks
      // WITHOUT following them. Symlinks are skipped entirely — a
      // symlinked directory inside the clone would otherwise let
      // the walk traverse arbitrary paths on disk.
      if (io.lstat !== undefined) {
        try {
          const ls = await io.lstat(full);
          if (ls.isSymbolicLink()) continue;
        } catch {
          continue;
        }
      }
      let s: { isDirectory(): boolean; isFile(): boolean };
      try {
        s = await io.stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        await recurse(full, depth + 1);
      } else if (s.isFile()) {
        // Byte size is intentionally a separate stat call. The
        // CodeSource interface declares `bytes` on FileWalkEntry; we
        // could derive it from the readDir stat in some
        // filesystems, but per CodeSource semantics this stays
        // accurate.
        let bytes = 0;
        try {
          const sf = await io.stat(full);
          bytes = (sf as unknown as { size?: number }).size ?? 0;
        } catch {
          // best effort
        }
        out.push({ path: rel, bytes });
        if (out.length >= maxFiles) return;
      }
    }
  }
  await recurse(root, 0);
  return out;
}

/**
 * Convenience wrapper for callers (e.g. `bootstrap.ts`) that want the
 * legacy `readonly string[]` shape rather than `FileWalkResult`.
 * Returns ONLY the relative paths.
 */
export async function walkPaths(
  io: CodeSourceFs | undefined,
  root: string,
  maxFiles: number,
  maxDepth: number,
): Promise<readonly string[]> {
  const entries = await walkInternal(io ?? DEFAULT_FS, root, maxFiles, maxDepth);
  return entries.map((e) => e.path);
}
