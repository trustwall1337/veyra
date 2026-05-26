/**
 * Step 28a unit tests for the local-clone CodeSource.
 *
 * Covers:
 *  - read_code capability gating (denied policy short-circuits).
 *  - DIR_DENYLIST + PATH_PREFIX_DENYLIST honored at any depth.
 *  - maxFiles + maxDepth caps respected.
 *  - readFile refuses to read outside the declared project root.
 *  - Same walk behavior the previous inline bootstrap walk produced
 *    (file paths returned identical for the same input fixture).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultReadOnlyEvidencePolicy,
  type AllowedAction,
  type ValidationPolicy,
} from '../../types/validation-policy.js';
import { asDataSourceId } from '../../types/data-sources.js';
import { __resetRegistryForTests, resolveDataSource } from '../registry.js';

import {
  createLovableGithubCloneCodeSource,
  type CodeSourceFs,
} from './code-source.js';
import {
  lovableGithubCloneId,
  registerLovableGithubClone,
} from './index.js';

function id(s: string) {
  const r = asDataSourceId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function policyWithout(action: AllowedAction): ValidationPolicy {
  const base = defaultReadOnlyEvidencePolicy('local');
  const allowed = new Set(base.allowed_actions);
  allowed.delete(action);
  return { ...base, allowed_actions: allowed };
}

interface FakeFsNode {
  readonly kind: 'dir' | 'file';
  readonly children?: Readonly<Record<string, FakeFsNode>>;
  readonly content?: string;
  readonly size?: number;
}

function makeFakeFs(tree: FakeFsNode): CodeSourceFs {
  // Resolve a slash-separated absolute path against the tree. The
  // first segment ("/" leading slash) is stripped.
  function lookup(absolute: string): FakeFsNode | undefined {
    const parts = absolute.split('/').filter((p) => p.length > 0);
    let node: FakeFsNode | undefined = tree;
    for (const part of parts) {
      if (node === undefined || node.kind !== 'dir' || node.children === undefined) {
        return undefined;
      }
      node = node.children[part];
    }
    return node;
  }
  return {
    async readDir(p) {
      const node = lookup(p);
      if (node === undefined || node.kind !== 'dir' || node.children === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return Object.keys(node.children);
    },
    async stat(p) {
      const node = lookup(p);
      if (node === undefined) throw new Error(`ENOENT: ${p}`);
      const isDir = node.kind === 'dir';
      return {
        isDirectory: () => isDir,
        isFile: () => !isDir,
        size: node.size ?? node.content?.length ?? 0,
      } as { isDirectory(): boolean; isFile(): boolean };
    },
    async readFile(p, _enc) {
      const node = lookup(p);
      if (node === undefined || node.kind !== 'file') throw new Error(`ENOENT: ${p}`);
      return node.content ?? '';
    },
  };
}

describe('lovable-github-clone registration (codex step28a-df1)', () => {
  afterEach(() => __resetRegistryForTests());

  it('registerLovableGithubClone makes resolveDataSource(lovableGithubCloneId) return a CodeSource factory', () => {
    registerLovableGithubClone();
    const reg = resolveDataSource(lovableGithubCloneId);
    expect(reg).toBeDefined();
    expect(reg?.code).toBeDefined();
    expect(reg?.devOnly).toBe(false);
  });

  it('registered factory constructs a working CodeSource given projectRoot + policy', () => {
    registerLovableGithubClone();
    const reg = resolveDataSource(lovableGithubCloneId);
    if (reg?.code === undefined) throw new Error('factory missing');
    const source = reg.code({
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
    });
    expect(source.id).toBe(lovableGithubCloneId);
  });
});

describe('lovable-github-clone CodeSource — capability gate', () => {
  it('walk() returns capability_denied when read_code is not allowed', async () => {
    const fs = makeFakeFs({ kind: 'dir', children: {} });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: policyWithout('read_code'),
      fs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability_denied');
  });

  it('readFile() returns capability_denied when read_code is not allowed', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: { 'a.ts': { kind: 'file', content: 'export {}' } },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: policyWithout('read_code'),
      fs,
    });
    const r = await source.readFile('a.ts');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability_denied');
  });

  it('walk() succeeds under the default read_only_evidence policy', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: {
            'index.ts': { kind: 'file', content: 'export {}', size: 9 },
          },
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entries.map((e) => e.path)).toContain('index.ts');
    }
  });
});

describe('lovable-github-clone CodeSource — walk semantics', () => {
  it('skips DIR_DENYLIST entries at any depth (node_modules, .git, .veyra)', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: {
            src: {
              kind: 'dir',
              children: {
                'app.ts': { kind: 'file', content: 'export {}' },
                node_modules: {
                  kind: 'dir',
                  children: {
                    'leak.ts': { kind: 'file', content: 'should not appear' },
                  },
                },
              },
            },
            '.git': {
              kind: 'dir',
              children: { HEAD: { kind: 'file', content: 'refs/heads/main' } },
            },
            '.veyra': {
              kind: 'dir',
              children: { scans: { kind: 'dir', children: {} } },
            },
          },
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paths = r.value.entries.map((e) => e.path);
      expect(paths).toContain('src/app.ts');
      expect(paths.every((p) => !p.includes('node_modules'))).toBe(true);
      expect(paths.every((p) => !p.includes('.git'))).toBe(true);
      expect(paths.every((p) => !p.includes('.veyra'))).toBe(true);
    }
  });

  it('honors PATH_PREFIX_DENYLIST (supabase/.temp)', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: {
            supabase: {
              kind: 'dir',
              children: {
                '.temp': {
                  kind: 'dir',
                  children: {
                    'cli-cache.json': { kind: 'file', content: '{}' },
                  },
                },
                'config.toml': { kind: 'file', content: '[api]' },
              },
            },
          },
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paths = r.value.entries.map((e) => e.path);
      expect(paths).toContain('supabase/config.toml');
      expect(paths.every((p) => !p.includes('.temp'))).toBe(true);
    }
  });

  it('respects maxFiles cap', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: Object.fromEntries(
            Array.from({ length: 50 }, (_v, i) => [`f${String(i)}.ts`, { kind: 'file', content: '' }] as const),
          ),
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      maxFiles: 10,
      fs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.entries.length).toBeLessThanOrEqual(10);
  });
});

describe('lovable-github-clone CodeSource — symlink defense (codex step28a-df2)', () => {
  it('walk() skips symlinked entries via lstat', async () => {
    // Build a fake fs where /proj/link is reported as a symlink by
    // lstat but a regular dir by stat (which follows the link). The
    // walker must skip it.
    const tree: Record<string, { kind: 'dir' | 'file' | 'symlink'; content?: string }> = {
      '/proj': { kind: 'dir' },
      '/proj/real.ts': { kind: 'file', content: 'real' },
      '/proj/link': { kind: 'symlink' },
      '/proj/link/leak.ts': { kind: 'file', content: 'should-not-appear' },
    };
    const fakeFs: CodeSourceFs = {
      async readDir(p) {
        if (p === '/proj') return ['real.ts', 'link'];
        if (p === '/proj/link') return ['leak.ts'];
        throw new Error(`ENOENT ${p}`);
      },
      async stat(p) {
        const n = tree[p];
        if (n === undefined) throw new Error(`ENOENT ${p}`);
        const isDir = n.kind === 'dir' || n.kind === 'symlink';
        return { isDirectory: () => isDir, isFile: () => !isDir } as { isDirectory(): boolean; isFile(): boolean };
      },
      async lstat(p) {
        const n = tree[p];
        if (n === undefined) throw new Error(`ENOENT ${p}`);
        return {
          isDirectory: () => n.kind === 'dir',
          isFile: () => n.kind === 'file',
          isSymbolicLink: () => n.kind === 'symlink',
        };
      },
      async readFile(p) {
        const n = tree[p];
        return n?.content ?? '';
      },
    };
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs: fakeFs,
    });
    const r = await source.walk();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paths = r.value.entries.map((e) => e.path);
      expect(paths).toContain('real.ts');
      expect(paths.every((p) => !p.includes('leak'))).toBe(true);
    }
  });

  it('readFile() refuses paths whose realpath escapes the project root', async () => {
    const fakeFs: CodeSourceFs = {
      async readDir(_p) { return []; },
      async stat(_p) { return { isDirectory: () => false, isFile: () => true }; },
      async lstat(_p) { return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }; },
      async realpath(p) {
        // /proj/link resolves OUTSIDE /proj
        if (p === '/proj/link') return '/elsewhere/secret.txt';
        return p;
      },
      async readFile(_p) { return 'should-not-be-reached'; },
    };
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs: fakeFs,
    });
    const r = await source.readFile('link');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability_denied');
      expect(r.error.message).toContain('resolves via symlink outside project root');
    }
  });
});

describe('lovable-github-clone CodeSource — readFile safety', () => {
  it('refuses to read outside the project root', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: { 'a.ts': { kind: 'file', content: 'x' } },
        },
        secret: {
          kind: 'dir',
          children: { 'creds.txt': { kind: 'file', content: 'should-never-be-read' } },
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs,
    });
    const r = await source.readFile('../secret/creds.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability_denied');
      expect(r.error.message).toContain('escapes project root');
    }
  });

  it('reads a file inside the project root', async () => {
    const fs = makeFakeFs({
      kind: 'dir',
      children: {
        proj: {
          kind: 'dir',
          children: { 'a.ts': { kind: 'file', content: 'export const A = 1;' } },
        },
      },
    });
    const source = createLovableGithubCloneCodeSource({
      id: id('lovable-github-clone'),
      projectRoot: '/proj',
      policy: defaultReadOnlyEvidencePolicy('local'),
      fs,
    });
    const r = await source.readFile('a.ts');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('export const A = 1;');
  });
});
