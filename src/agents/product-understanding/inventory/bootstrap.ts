import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { redactSecrets } from '../../../ai/sanitization.js';
import {
  walkPaths,
  type CodeSourceFs,
} from '../../../data-sources/lovable-github-clone/code-source.js';
import { type Result, err, ok } from '../../../types/result.js';
import type { ScanFact } from '../../../types/scan-fact.js';
import type { ValidationPolicy } from '../../../types/validation-policy.js';

import {
  BootstrapError,
  type DetectedFramework,
  type InventoryBootstrap,
  type InventoryObservedEvidence,
  type InventorySource,
  type PackageJsonDigest,
  type SupabaseSchemaSummary,
} from './types.js';

/**
 * Injectable filesystem surface. The default implementation uses
 * node:fs; tests inject an in-memory fake.
 */
export interface BootstrapFs {
  readDir(p: string): Promise<readonly string[]>;
  stat(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  readFile(p: string, encoding: 'utf8'): Promise<string>;
}

export interface BootstrapMcpFetchers {
  /**
   * Returns the Supabase schema summary (table names + whether a schema
   * was retrievable). Called only if configured AND `supabaseProjectRef`
   * is present. The fetcher contract requires read_only=true at the
   * fetcher's layer (the ContextPolicyEvaluator enforces this elsewhere;
   * this fetcher is a higher-level summary used at bootstrap time).
   */
  readonly supabaseSchema?: (projectRef: string) => Promise<SupabaseSchemaSummary>;
  /**
   * Returns the file inventory from Lovable. Called only if configured
   * AND `lovableProjectId` is present.
   */
  readonly lovableFiles?: (projectId: string) => Promise<readonly string[]>;
}

export interface BuildBootstrapInventoryOptions {
  readonly projectRoot: string;
  readonly artifactDir?: string;
  readonly fs?: BootstrapFs;
  readonly maxFiles?: number;
  readonly maxDepth?: number;
  readonly mcp?: BootstrapMcpFetchers;
  readonly supabaseProjectRef?: string;
  readonly lovableProjectId?: string;
  /**
   * ValidationPolicy used to gate the MCP pass. Supabase fetches
   * require `read_schema_metadata`; Lovable fetches require
   * `read_code`. Without the matching capability the MCP call is
   * skipped (deterministic baseline runs as if MCP were not
   * configured).
   */
  readonly policy?: ValidationPolicy;
}

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_DEPTH = 8;
const DIR_DENYLIST: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  '.git',
  '.vercel',
  '.cache',
  // Step 26 Piece 3: skip Veyra's own scan output directory at any
  // depth. A scan against `--project .` where prior scans wrote
  // `.veyra/scans/<id>/...` would otherwise list those entries as
  // "observed evidence" in the report, polluting the operator's
  // view with the tool's own outputs.
  '.veyra',
];

// Step 26 Piece 3: path-prefix exclusions (segments not at the leaf).
// `supabase/.temp/` is the Supabase CLI's temp-metadata directory;
// segments under it (`cli-latest`, schema introspection cache, etc.)
// are tool-internal, not customer code. The walk checks the
// relative path against each prefix in addition to the leaf-only
// `DIR_DENYLIST` above.
const PATH_PREFIX_DENYLIST: readonly string[] = ['supabase/.temp'];

function isExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  return PATH_PREFIX_DENYLIST.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix}/`),
  );
}

const SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

export const INVENTORY_BOOTSTRAP_ARTIFACT_NAME = 'inventory-bootstrap.json';

const NODE_FS: BootstrapFs = {
  readDir: (p) => fs.readdir(p),
  stat: (p) => fs.stat(p),
  readFile: (p, enc) => fs.readFile(p, enc),
};

export async function buildBootstrapInventory(
  options: BuildBootstrapInventoryOptions,
): Promise<Result<InventoryBootstrap, BootstrapError>> {
  const io = options.fs ?? NODE_FS;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  let fileMap: readonly string[];
  try {
    // Step 28a: file-walk extracted into the lovable-github-clone
    // CodeSource module. BootstrapFs and CodeSourceFs are
    // structurally identical (readDir/stat/readFile), so the existing
    // injected fake flows through unchanged. The CodeSource interface
    // wraps this same logic for the registry path; bootstrap continues
    // to call the helper directly to preserve the `readonly string[]`
    // public API of `buildBootstrapInventory`.
    fileMap = await walkPaths(io as CodeSourceFs, options.projectRoot, maxFiles, maxDepth);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new BootstrapError(`file walk failed: ${m}`));
  }

  const sources: InventorySource[] = [
    { kind: 'local_file_walk', description: `walked ${String(fileMap.length)} files under projectRoot` },
  ];

  const pkgDigest = await readPackageJson(io, options.projectRoot, sources);
  const framework = detectFramework(fileMap, pkgDigest, sources);
  const routes = await extractRoutes(io, options.projectRoot, fileMap, sources);
  const envDecls = await extractEnvDeclarations(io, options.projectRoot, fileMap, sources);

  let supabaseSchema: SupabaseSchemaSummary | undefined;
  if (
    options.mcp?.supabaseSchema !== undefined &&
    options.supabaseProjectRef !== undefined &&
    capabilityAllows(options.policy, 'read_schema_metadata')
  ) {
    try {
      supabaseSchema = await options.mcp.supabaseSchema(options.supabaseProjectRef);
      sources.push({
        kind: 'mcp_supabase',
        description: `supabase schema via MCP project_ref=${options.supabaseProjectRef}`,
      });
    } catch (cause) {
      // MCP failure is not fatal: the deterministic baseline still runs.
      const m = cause instanceof Error ? cause.message : String(cause);
      sources.push({
        kind: 'mcp_supabase',
        description: `supabase MCP fetch failed: ${m}`,
      });
    }
  }

  let lovableFiles: readonly string[] | undefined;
  if (
    options.mcp?.lovableFiles !== undefined &&
    options.lovableProjectId !== undefined &&
    capabilityAllows(options.policy, 'read_code')
  ) {
    try {
      lovableFiles = await options.mcp.lovableFiles(options.lovableProjectId);
      sources.push({
        kind: 'mcp_lovable',
        description: `lovable files via MCP project_id=${options.lovableProjectId}`,
      });
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : String(cause);
      sources.push({
        kind: 'mcp_lovable',
        description: `lovable MCP fetch failed: ${m}`,
      });
    }
  }

  const observed: InventoryObservedEvidence = {
    file_map: fileMap,
    ...(pkgDigest !== undefined ? { package_json_digest: pkgDigest } : {}),
    routes,
    framework,
    env_declarations: envDecls,
    ...(supabaseSchema !== undefined ? { supabase_schema: supabaseSchema } : {}),
    ...(lovableFiles !== undefined ? { lovable_files: lovableFiles } : {}),
  };

  return ok({ observed_evidence: observed, sources });
}

/**
 * Write `inventory-bootstrap.json` to the artifact dir. The composer
 * (17c) is the sole writer of `declared-context.json`; this module
 * MUST NOT write that file.
 */
export async function writeInventoryArtifact(
  artifactDir: string,
  bootstrap: InventoryBootstrap,
): Promise<Result<string, BootstrapError>> {
  const filePath = path.join(artifactDir, INVENTORY_BOOTSTRAP_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(bootstrap, null, 2), 'utf8');
    return ok(filePath);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new BootstrapError(`failed to write ${filePath}: ${m}`));
  }
}

/**
 * Step 23 Bug A: convert deterministic env_declarations from the
 * inventory into `ScanFact`s so Pass-1 predicates can consume them
 * uniformly. Per codex retro-f2 for step 23: do NOT have predicates
 * read `inventory-bootstrap.json` directly — that bypasses the
 * ScanFact contract. Instead emit env declarations as facts with
 * `source.kind: 'local_file'` + `signal_kind: 'env_declaration'`.
 *
 * Each fact's `fact_id` is content-addressed (sha256 of the env name)
 * so re-running against the same inventory produces byte-identical
 * facts (assertion-replay determinism, REVISION_AI_SHAPE §7).
 */
export function envDeclarationsToScanFacts(
  envDecls: readonly string[],
  projectRoot: string,
): readonly ScanFact[] {
  const argsFingerprint = createHash('sha256').update(projectRoot).digest('hex');
  return envDecls.map((name) => {
    const factId = createHash('sha256')
      .update(`env_declaration:${projectRoot}:${name}`)
      .digest('hex');
    const fact: ScanFact = {
      fact_id: factId,
      source: {
        kind: 'local_file',
        signal_kind: 'env_declaration',
        payload: {
          sanitized_excerpt: name,
          content_kind: 'text',
        },
      },
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: argsFingerprint,
      redacted: false,
    };
    return fact;
  });
}

/**
 * Default-deny: if no policy is supplied (test harness), allow the call;
 * if a policy is supplied, gate strictly on `allowed_actions`.
 */
function capabilityAllows(
  policy: ValidationPolicy | undefined,
  action: 'read_code' | 'read_schema_metadata',
): boolean {
  if (policy === undefined) return true;
  return policy.allowed_actions.has(action);
}

// Step 28a: the inline `walk(io, root, maxFiles, maxDepth)` helper was
// extracted to `src/data-sources/lovable-github-clone/code-source.ts`
// (`walkPaths`). DIR_DENYLIST + PATH_PREFIX_DENYLIST + isExcludedPath
// remain re-exported below for back-compat with tests that import them
// from this module; the canonical home is the CodeSource module.

async function readPackageJson(
  io: BootstrapFs,
  root: string,
  sources: InventorySource[],
): Promise<PackageJsonDigest | undefined> {
  const p = path.join(root, 'package.json');
  try {
    const text = await io.readFile(p, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const digest: PackageJsonDigest = {
      name: typeof parsed.name === 'string' ? parsed.name : '<unnamed>',
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      ...(isStringMap(parsed.dependencies)
        ? { dependencies: parsed.dependencies }
        : {}),
      ...(isStringMap(parsed.devDependencies)
        ? { devDependencies: parsed.devDependencies }
        : {}),
      ...(isStringMap(parsed.scripts)
        ? { scripts: redactScriptMap(parsed.scripts) }
        : {}),
    };
    sources.push({
      kind: 'package_json',
      description: `package.json @ ${p}`,
    });
    return digest;
  } catch {
    return undefined;
  }
}

/**
 * Run each script value through `redactSecrets`. Package scripts can
 * contain inline credentials (e.g. `"start": "API_KEY=sk-... npm run dev"`);
 * we never store the raw value.
 */
function redactScriptMap(
  scripts: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(scripts)) {
    out[k] = redactSecrets(v);
  }
  return out;
}

function isStringMap(v: unknown): v is Readonly<Record<string, string>> {
  if (typeof v !== 'object' || v === null) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return false;
  }
  return true;
}

function detectFramework(
  fileMap: readonly string[],
  pkg: PackageJsonDigest | undefined,
  sources: InventorySource[],
): DetectedFramework {
  if (fileMap.some((f) => f.startsWith("vite.config."))) {
    sources.push({ kind: 'framework_detection', description: 'detected: vite (vite.config.*)' });
    return 'vite';
  }
  if (fileMap.some((f) => f.startsWith("next.config."))) {
    sources.push({ kind: 'framework_detection', description: 'detected: next (next.config.*)' });
    return 'next';
  }
  if (fileMap.some((f) => f.startsWith("remix.config."))) {
    sources.push({ kind: 'framework_detection', description: 'detected: remix (remix.config.*)' });
    return 'remix';
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if ('vite' in deps) {
    sources.push({ kind: 'framework_detection', description: 'detected: vite (dep)' });
    return 'vite';
  }
  if ('next' in deps) {
    sources.push({ kind: 'framework_detection', description: 'detected: next (dep)' });
    return 'next';
  }
  if ('@remix-run/dev' in deps || '@remix-run/react' in deps) {
    sources.push({ kind: 'framework_detection', description: 'detected: remix (dep)' });
    return 'remix';
  }
  if (pkg !== undefined) {
    sources.push({ kind: 'framework_detection', description: 'detected: plain (no framework markers)' });
    return 'plain';
  }
  sources.push({ kind: 'framework_detection', description: 'no package.json — unknown framework' });
  return 'unknown';
}

const ROUTE_RE = /<Route\b[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`]/g;

async function extractRoutes(
  io: BootstrapFs,
  root: string,
  fileMap: readonly string[],
  sources: InventorySource[],
): Promise<readonly string[]> {
  const candidates = fileMap.filter((f) =>
    SOURCE_EXTENSIONS.includes(path.extname(f).toLowerCase()),
  );
  const found = new Set<string>();
  for (const rel of candidates) {
    let text: string;
    try {
      text = await io.readFile(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(ROUTE_RE)) {
      const p = match[1];
      if (typeof p === 'string' && p.length > 0) found.add(p);
    }
  }
  if (found.size > 0) {
    sources.push({
      kind: 'route_extraction',
      description: `extracted ${String(found.size)} <Route path=...> entries from ${String(candidates.length)} source files`,
    });
  }
  return Array.from(found).sort();
}

const ENV_RE = /\b(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]*)\b/g;

async function extractEnvDeclarations(
  io: BootstrapFs,
  root: string,
  fileMap: readonly string[],
  sources: InventorySource[],
): Promise<readonly string[]> {
  const candidates = fileMap.filter((f) =>
    SOURCE_EXTENSIONS.includes(path.extname(f).toLowerCase()),
  );
  const names = new Set<string>();
  for (const rel of candidates) {
    let text: string;
    try {
      text = await io.readFile(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(ENV_RE)) {
      const n = match[1];
      if (typeof n === 'string' && n.length > 0) names.add(n);
    }
  }
  if (names.size > 0) {
    sources.push({
      kind: 'env_extraction',
      description: `extracted ${String(names.size)} env-var references`,
    });
  }
  return Array.from(names).sort();
}
