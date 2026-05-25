import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';

import { detectAuthnIssues, type AuthnRouteFinding } from './heuristics.js';
import type { AuthnInput, AuthnOutput } from './types.js';

const METADATA: AgentMetadata = {
  id: 'authn',
  version: '0.1.0',
  declared_dependencies: ['scan-facts.json'],
};

const UNCERTAINTY_NOTE =
  'static authn detection; server-side checks via SSR/middleware or framework conventions may exist but not be detected';

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

async function readSemgrepFindings(
  artifactPath: string | undefined,
): Promise<readonly { ruleId: string; filePath: string; line: number }[]> {
  if (artifactPath === undefined) return [];
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f): f is Record<string, unknown> =>
          typeof f === 'object' && f !== null,
      )
      .map((f) => ({
        ruleId: typeof f['rule_id'] === 'string' ? f['rule_id'] : '',
        filePath: typeof f['file_path'] === 'string' ? f['file_path'] : '',
        line: typeof f['line'] === 'number' ? f['line'] : 0,
      }));
  } catch {
    return [];
  }
}

function semgrepRefsFor(
  routeFinding: AuthnRouteFinding,
  semgrepFindings: readonly { ruleId: string; filePath: string; line: number }[],
): readonly string[] {
  return semgrepFindings
    .filter((s) => s.filePath === routeFinding.filePath)
    .map((s) => `semgrep:${s.ruleId}:${s.filePath}:${String(s.line)}`);
}

function buildFinding(
  routeFinding: AuthnRouteFinding,
  evidenceRefs: readonly string[],
): Finding {
  if (routeFinding.kind === 'cc-11-1') {
    return {
      id: `cc-11-1-${routeFinding.filePath}:${String(routeFinding.line)}`,
      control_id: 'cc-11-1',
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'user_data',
      title: `Client-side route guard appears to be the only authentication gate`,
      summary: `${routeFinding.filePath}:${String(routeFinding.line)} — \`${routeFinding.excerpt}\` redirects on the client when no user is present, but no server-side check was detected anywhere in the project. A request that skips the client and hits the data fetch directly appears to succeed. Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: evidenceRefs,
    };
  }
  return {
    id: `cc-11-2-${routeFinding.filePath}:${String(routeFinding.line)}`,
    control_id: 'cc-11-2',
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'fix_before_launch',
    blast_radius: 'admin_access',
    title: `Admin route without a detectable server-side role check`,
    summary: `${routeFinding.filePath}:${String(routeFinding.line)} — \`${routeFinding.excerpt}\`. The admin route renders, but no server-side role check (is_admin / hasRole('admin') / requireRole / RBAC) was detected in the project. Needs human review. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: evidenceRefs,
  };
}

function coverageGap(controlId: 'cc-11-1' | 'cc-11-2'): Finding {
  return {
    id: `${controlId}-coverage-gap`,
    control_id: controlId,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius:
      controlId === 'cc-11-2' ? 'admin_access' : 'user_data',
    title: `${controlId === 'cc-11-1' ? 'Client-side route guard' : 'Admin route role-check'} was not checked`,
    summary: `tool-runner did not produce scan-facts.json, so Semgrep evidence could not be cited. Negative tests should be added once the artifact is available. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
  };
}

export function createAuthnAgent(): VeyraAgent<AuthnInput, AuthnOutput> {
  return {
    metadata: METADATA,
    async run(
      input: AuthnInput,
      _context: AgentExecutionContext,
    ): Promise<AgentResult<AuthnOutput>> {
      const files = await walkSources(input.projectRoot);
      const routeFindings = detectAuthnIssues({ fileList: files });
      const semgrep = await readSemgrepFindings(
        input.scannerFindingsArtifactPath,
      );

      const findings: Finding[] = [];

      // Coverage gaps when the upstream artifact is missing.
      if (input.scannerFindingsArtifactPath === undefined) {
        findings.push(coverageGap('cc-11-1'));
        findings.push(coverageGap('cc-11-2'));
      }

      for (const rf of routeFindings) {
        const refs = semgrepRefsFor(rf, semgrep);
        findings.push(buildFinding(rf, refs));
      }

      return {
        status: 'completed',
        artifacts: [],
        findings,
        warnings: [],
        output: {
          findingsCount: findings.length,
          routesScanned: files.length,
        },
      };
    },
  };
}
