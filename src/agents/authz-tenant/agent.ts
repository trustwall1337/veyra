import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';

import { detectAuthzIssues, type AuthzMatch } from './heuristics.js';
import type { AuthzTenantInput, AuthzTenantOutput } from './types.js';

const METADATA: AgentMetadata = {
  id: 'authz-tenant',
  version: '0.1.0',
  declared_dependencies: ['scan_facts', 'supabase-tables.json'],
};

const UNCERTAINTY_NOTE =
  'static authz detection; server-side authorization via SSR/middleware or row-level policies may exist but not be detected';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DENY_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  '.git',
]);

async function walkSources(
  root: string,
): Promise<readonly { filePath: string; content: string }[]> {
  const out: { filePath: string; content: string }[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (DENY_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        try {
          const content = await fs.readFile(abs, 'utf8');
          out.push({ filePath: path.relative(root, abs), content });
        } catch {
          // ignore
        }
      }
    }
  }
  await walk(root, 0);
  return out;
}

async function readSensitiveTableNames(
  artifactPath: string | undefined,
): Promise<readonly string[] | undefined> {
  if (artifactPath === undefined) return undefined;
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as {
      tables?: readonly { name?: string }[];
    };
    return (parsed.tables ?? [])
      .map((t) => t.name)
      .filter((n): n is string => typeof n === 'string');
  } catch {
    return undefined;
  }
}

function buildFinding(match: AuthzMatch): Finding {
  if (match.kind === 'cc-11-3') {
    return {
      id: `cc-11-3-${match.filePath}:${String(match.line)}`,
      control_id: 'cc-11-3',
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'tenant_data',
      title: `Direct-object access by id on sensitive table "${match.table ?? '<unknown>'}" without a tenant/user filter`,
      summary: `${match.filePath}:${String(match.line)} — \`${match.excerpt}\` queries by id on a sensitive table with no .eq('tenant_id' | 'user_id' | 'workspace_id') clause nearby. Any signed-in user appears able to read rows owned by other users. Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [],
      suggested_test_ids: [
        'GET /api/<sensitive>/:id as user_b should return 403',
      ],
    };
  }
  return {
    id: `cc-11-4-${match.filePath}:${String(match.line)}`,
    control_id: 'cc-11-4',
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'fix_before_launch',
    blast_radius: 'tenant_data',
    title: `Client-provided tenant identifier used in a query without server-side validation`,
    summary: `${match.filePath}:${String(match.line)} — \`${match.excerpt}\`. The tenant scope is read from URL/search params and used directly in a Supabase query. No detectable server-side check confirms the caller belongs to that tenant. Needs human review. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
    suggested_test_ids: [
      'GET /<page>?tenant_id=<other> as user_a should return 403 or empty',
    ],
  };
}

function coverageGap(): Finding {
  return {
    id: 'cc-11-3-coverage-gap-no-supabase-tables',
    control_id: 'cc-11-3',
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: 'Tenant-isolation checks were not performed (no supabase-tables.json)',
    summary: `supabase-rls agent did not produce supabase-tables.json, so the sensitive-table list could not be cross-referenced with data-access call sites. Negative tests should be added. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
  };
}

export function createAuthzTenantAgent(): VeyraAgent<
  AuthzTenantInput,
  AuthzTenantOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: AuthzTenantInput,
      _context: AgentExecutionContext,
    ): Promise<AgentResult<AuthzTenantOutput>> {
      const files = await walkSources(input.projectRoot);
      const sensitive = await readSensitiveTableNames(
        input.supabaseTablesArtifactPath,
      );
      const matches = detectAuthzIssues({
        fileList: files,
        ...(sensitive !== undefined
          ? { sensitiveTableNames: sensitive }
          : {}),
      });

      const findings: Finding[] = [];
      if (input.supabaseTablesArtifactPath === undefined) {
        findings.push(coverageGap());
      }
      for (const m of matches) findings.push(buildFinding(m));

      return {
        status: 'completed',
        artifacts: [],
        findings,
        warnings: [],
        output: {
          findingsCount: findings.length,
          filesScanned: files.length,
        },
      };
    },
  };
}
