import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isOk } from '../../../types/result.js';
import {
  defaultReadOnlyEvidencePolicy,
  type ValidationPolicy,
} from '../../../types/validation-policy.js';

import {
  INVENTORY_BOOTSTRAP_ARTIFACT_NAME,
  buildBootstrapInventory,
  writeInventoryArtifact,
  type BootstrapFs,
} from './bootstrap.js';

function makeFakeFs(
  tree: Readonly<Record<string, string>>,
  dirs: readonly string[] = [],
): BootstrapFs {
  const isDir = (p: string): boolean =>
    dirs.includes(p) ||
    Object.keys(tree).some((f) => f.startsWith(p + '/'));
  const isFile = (p: string): boolean => p in tree;
  return {
    readDir: async (p) => {
      const seen = new Set<string>();
      for (const key of Object.keys(tree)) {
        if (key === p) continue;
        if (key.startsWith(p + '/')) {
          const tail = key.slice(p.length + 1);
          const head = tail.split('/')[0];
          if (head !== undefined && head.length > 0) seen.add(head);
        }
      }
      for (const d of dirs) {
        if (d === p) continue;
        if (d.startsWith(p + '/')) {
          const tail = d.slice(p.length + 1);
          const head = tail.split('/')[0];
          if (head !== undefined && head.length > 0) seen.add(head);
        }
      }
      return Array.from(seen);
    },
    stat: async (p) => ({
      isDirectory: () => isDir(p),
      isFile: () => isFile(p),
    }),
    readFile: async (p) => {
      const text = tree[p];
      if (text === undefined) throw new Error(`ENOENT: ${p}`);
      return text;
    },
  };
}

describe('buildBootstrapInventory — local pass', () => {
  it('walks the project tree, ignoring denylisted directories', async () => {
    const tree: Record<string, string> = {
      '/p/package.json': JSON.stringify({ name: 'demo', dependencies: { vite: '^5.0.0' } }),
      '/p/src/App.tsx': 'const x = 1;',
      '/p/vite.config.ts': 'export default {}',
      '/p/node_modules/foo/index.js': 'should not appear',
      '/p/dist/bundle.js': 'should not appear',
    };
    const dirs = ['/p', '/p/src', '/p/node_modules', '/p/node_modules/foo', '/p/dist'];
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, dirs),
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const fm = r.value.observed_evidence.file_map;
      expect(fm).toContain('package.json');
      expect(fm).toContain('src/App.tsx');
      expect(fm).toContain('vite.config.ts');
      expect(fm.every((f) => !f.startsWith('node_modules'))).toBe(true);
      expect(fm.every((f) => !f.startsWith('dist'))).toBe(true);
    }
  });

  it('reads package.json digest with deps preserved', async () => {
    const tree: Record<string, string> = {
      '/p/package.json': JSON.stringify({
        name: 'demo',
        version: '1.2.3',
        dependencies: { vite: '^5.0.0', react: '^18.0.0' },
      }),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p']),
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.observed_evidence.package_json_digest?.name).toBe('demo');
      expect(r.value.observed_evidence.package_json_digest?.version).toBe('1.2.3');
      expect(r.value.observed_evidence.package_json_digest?.dependencies?.['react']).toBe('^18.0.0');
    }
  });

  it('detects framework: vite via vite.config.ts', async () => {
    const tree: Record<string, string> = {
      '/p/vite.config.ts': '',
      '/p/package.json': JSON.stringify({ name: 'demo' }),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p']),
    });
    if (isOk(r)) {
      expect(r.value.observed_evidence.framework).toBe('vite');
    }
  });

  it('detects framework: next via dependency', async () => {
    const tree: Record<string, string> = {
      '/p/package.json': JSON.stringify({ name: 'demo', dependencies: { next: '^14' } }),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p']),
    });
    if (isOk(r)) {
      expect(r.value.observed_evidence.framework).toBe('next');
    }
  });

  it('extracts <Route path=...> entries from JSX/TSX files', async () => {
    const tree: Record<string, string> = {
      '/p/package.json': '{}',
      '/p/src/App.tsx': `
        import { Route } from 'react-router';
        export const App = () => (
          <Routes>
            <Route path="/orders" />
            <Route path="/admin/users" />
          </Routes>
        );
      `,
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p', '/p/src']),
    });
    if (isOk(r)) {
      expect(r.value.observed_evidence.routes).toContain('/orders');
      expect(r.value.observed_evidence.routes).toContain('/admin/users');
    }
  });

  it('extracts env-var references from import.meta.env and process.env', async () => {
    const tree: Record<string, string> = {
      '/p/package.json': '{}',
      '/p/src/cfg.ts': `
        const u = import.meta.env.VITE_SUPABASE_URL;
        const k = process.env.SUPABASE_ANON_KEY;
      `,
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p', '/p/src']),
    });
    if (isOk(r)) {
      expect(r.value.observed_evidence.env_declarations).toContain('VITE_SUPABASE_URL');
      expect(r.value.observed_evidence.env_declarations).toContain('SUPABASE_ANON_KEY');
    }
  });
});

describe('package_json — secret hygiene', () => {
  it('redacts inline credentials in package scripts', async () => {
    const fakeKey = ['sk', '-', 'ant-', 'api03-', 'A'.repeat(40)].join('');
    const tree: Record<string, string> = {
      '/p/package.json': JSON.stringify({
        name: 'demo',
        scripts: { start: `ANTHROPIC_API_KEY=${fakeKey} node server.js` },
      }),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs(tree, ['/p']),
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const scripts = r.value.observed_evidence.package_json_digest?.scripts;
      expect(scripts).toBeDefined();
      const startScript = scripts?.['start'] ?? '';
      expect(startScript).not.toContain(fakeKey);
      expect(startScript).toContain('REDACTED');
    }
  });
});

describe('buildBootstrapInventory — MCP pass (injected fetchers)', () => {
  it('includes supabase_schema when fetcher + projectRef configured', async () => {
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        supabaseSchema: async () => ({ tables: ['orders', 'users'], schema_present: true }),
      },
      supabaseProjectRef: 'ref-abc',
    });
    if (isOk(r)) {
      expect(r.value.observed_evidence.supabase_schema?.tables).toEqual(['orders', 'users']);
    }
  });

  it('handles MCP fetcher failure non-fatally', async () => {
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        supabaseSchema: async () => {
          throw new Error('mcp down');
        },
      },
      supabaseProjectRef: 'ref-abc',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.observed_evidence.supabase_schema).toBeUndefined();
      const sourceKinds = r.value.sources.map((s) => s.kind);
      expect(sourceKinds).toContain('mcp_supabase');
    }
  });

  it('does not call MCP when projectRef is absent', async () => {
    let called = false;
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        supabaseSchema: async () => {
          called = true;
          return { tables: [], schema_present: false };
        },
      },
    });
    expect(isOk(r)).toBe(true);
    expect(called).toBe(false);
  });

  it('does not call Supabase MCP when the policy lacks read_schema_metadata', async () => {
    let called = false;
    const stripped: ValidationPolicy = {
      ...defaultReadOnlyEvidencePolicy('local'),
      allowed_actions: new Set(),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        supabaseSchema: async () => {
          called = true;
          return { tables: [], schema_present: false };
        },
      },
      supabaseProjectRef: 'ref-abc',
      policy: stripped,
    });
    expect(isOk(r)).toBe(true);
    expect(called).toBe(false);
  });

  it('does not call Lovable MCP when the policy lacks read_code', async () => {
    let called = false;
    const stripped: ValidationPolicy = {
      ...defaultReadOnlyEvidencePolicy('local'),
      allowed_actions: new Set(),
    };
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        lovableFiles: async () => {
          called = true;
          return [];
        },
      },
      lovableProjectId: 'proj-123',
      policy: stripped,
    });
    expect(isOk(r)).toBe(true);
    expect(called).toBe(false);
  });

  it('calls Supabase MCP when the policy allows read_schema_metadata', async () => {
    let called = false;
    const r = await buildBootstrapInventory({
      projectRoot: '/p',
      fs: makeFakeFs({ '/p/package.json': '{}' }, ['/p']),
      mcp: {
        supabaseSchema: async () => {
          called = true;
          return { tables: ['orders'], schema_present: true };
        },
      },
      supabaseProjectRef: 'ref-abc',
      policy: defaultReadOnlyEvidencePolicy('local'),
    });
    expect(isOk(r)).toBe(true);
    expect(called).toBe(true);
    if (isOk(r)) {
      expect(r.value.observed_evidence.supabase_schema?.tables).toContain('orders');
    }
  });
});

describe('writeInventoryArtifact', () => {
  it('writes inventory-bootstrap.json to the artifact dir and never writes declared-context.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-inv-'));
    const bootstrap = {
      observed_evidence: {
        file_map: ['package.json'],
        routes: [],
        framework: 'vite' as const,
        env_declarations: [],
      },
      sources: [],
    };
    const r = await writeInventoryArtifact(tmp, bootstrap);
    expect(isOk(r)).toBe(true);
    const written = await fs.readdir(tmp);
    expect(written).toContain(INVENTORY_BOOTSTRAP_ARTIFACT_NAME);
    expect(written).not.toContain('declared-context.json');
    const content = JSON.parse(
      await fs.readFile(path.join(tmp, INVENTORY_BOOTSTRAP_ARTIFACT_NAME), 'utf8'),
    ) as { observed_evidence?: Record<string, unknown> };
    expect(content.observed_evidence).toBeDefined();
    // 'declared_intent' must NOT be in this artifact (revision §7.1).
    const root = content as unknown as Record<string, unknown>;
    expect(root['declared_intent']).toBeUndefined();
  });
});

describe('cross-module isolation', () => {
  it('does not import any AI provider (no ai/anthropic, no ai/types beyond sanitization)', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('./bootstrap.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("from '../../../ai/anthropic");
    expect(source).not.toContain("from '../../../ai/types");
  });
});

describe('integration — vulnerable fixture', () => {
  it('produces observed_evidence and writes inventory-bootstrap.json (no declared_intent)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(here, '../../../../examples/vulnerable-lovable-supabase');
    const r = await buildBootstrapInventory({ projectRoot: fixtureRoot });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const ev = r.value.observed_evidence;
    expect(ev.file_map.length).toBeGreaterThan(0);
    expect(ev.file_map).toContain('package.json');
    expect(['vite', 'plain', 'unknown']).toContain(ev.framework);
    expect(ev.package_json_digest?.name).toBeDefined();

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-fixture-inv-'));
    const writeR = await writeInventoryArtifact(tmp, r.value);
    expect(isOk(writeR)).toBe(true);
    const written = await fs.readdir(tmp);
    expect(written).toContain(INVENTORY_BOOTSTRAP_ARTIFACT_NAME);
    expect(written).not.toContain('declared-context.json');
    const content = JSON.parse(
      await fs.readFile(path.join(tmp, INVENTORY_BOOTSTRAP_ARTIFACT_NAME), 'utf8'),
    ) as Record<string, unknown>;
    expect(content['observed_evidence']).toBeDefined();
    expect(content['declared_intent']).toBeUndefined();
  });
});
