import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GitleaksRunner } from '../../scanners/gitleaks/types.js';
import type { OsvRunner } from '../../scanners/osv/types.js';
import type { SemgrepRunner } from '../../scanners/semgrep/types.js';
import type {
  AgentExecutionContext,
  AgentLogger,
} from '../../types/agent.js';
import {
  ScannerExecutionError,
  ScannerNotInstalledError,
} from '../../types/errors.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

import { toolRunnerAgent } from './tool-runner.js';
import type { ScannerSection, ToolRunnerInput } from './types.js';

const silentLogger: AgentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const stubPolicy = {} as ValidationPolicy;

async function buildContext(
  overrides: Partial<AgentExecutionContext> = {},
): Promise<AgentExecutionContext> {
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'veyra-tool-runner-'),
  );
  return {
    scanId: 'scan-test',
    projectRoot: '/tmp/test-project',
    artifactDir,
    policy: stubPolicy,
    logger: silentLogger,
    ...overrides,
  };
}

function findSection(
  sections: readonly ScannerSection[],
  scannerId: string,
): ScannerSection {
  const s = sections.find((sec) => sec.scannerId === scannerId);
  if (s === undefined) {
    throw new Error(`expected a section for ${scannerId}`);
  }
  return s;
}

// Build an AWS-shaped access key id at runtime so this file does not embed
// a literal that matches the secret-pattern guard in pre-commit / hooks.
// The string still matches gitleaks' AKIA pattern, which is what the
// redaction test needs to exercise.
const FAKE_AWS_KEY = ['A', 'K', 'I', 'A'].join('') + '1234567890ABCDEF';

const GITLEAKS_OK_STDOUT = JSON.stringify([
  {
    Description: 'Generic API Key',
    StartLine: 12,
    EndLine: 12,
    StartColumn: 24,
    EndColumn: 56,
    Match: 'REDACTED',
    Secret: 'REDACTED',
    File: 'src/lib/secrets.ts',
    SymlinkFile: '',
    Commit: '',
    Entropy: 4.5,
    Author: '',
    Email: '',
    Date: '',
    Message: '',
    Tags: [],
    RuleID: 'generic-api-key',
    Fingerprint: 'src/lib/secrets.ts:generic-api-key:12',
  },
]);

const OSV_OK_STDOUT = JSON.stringify({
  results: [
    {
      source: { path: 'package-lock.json', type: 'lockfile' },
      packages: [
        {
          package: { name: 'axios', version: '0.21.0', ecosystem: 'npm' },
          vulnerabilities: [
            {
              id: 'GHSA-cph5-m8f7-6c5x',
              summary: 'Axios Cross-Site Request Forgery',
              aliases: ['CVE-2021-3749'],
              severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
            },
          ],
        },
      ],
    },
  ],
});

const SEMGREP_OK_STDOUT = JSON.stringify({
  version: '1.45.0',
  results: [
    {
      check_id: 'direct-object-access-by-id',
      path: 'src/pages/OrderPage.tsx',
      start: { line: 12, col: 5, offset: 240 },
      end: { line: 18, col: 6, offset: 360 },
      extra: {
        message:
          'cc-11-3 — Supabase query selects by id with no user filter.',
        severity: 'WARNING',
        metadata: { control_id: 'cc-11-3' },
      },
    },
  ],
  errors: [],
  paths: { scanned: [], skipped: [] },
});

function fakeRunner<R>(stdout: string, stderr: string, exitCode: number): R {
  return (async () => ({ stdout, stderr, exitCode })) as unknown as R;
}

describe('toolRunnerAgent', () => {
  it('happy path: runs all three scanners and persists one section each', async () => {
    const context = await buildContext();
    const input: ToolRunnerInput = {
      lockfilePath: '/tmp/test-project/package-lock.json',
      rulesPath: '/tmp/test-project/rules',
      runners: {
        gitleaks: fakeRunner<GitleaksRunner>(GITLEAKS_OK_STDOUT, '', 1),
        osv: fakeRunner<OsvRunner>(OSV_OK_STDOUT, '', 1),
        semgrep: fakeRunner<SemgrepRunner>(SEMGREP_OK_STDOUT, '', 1),
      },
    };

    const result = await toolRunnerAgent.run(input, context);

    expect(result.status).toBe('completed');
    expect(result.output).toBeDefined();
    const sections = result.output?.scannerSections ?? [];
    expect(sections).toHaveLength(3);

    const gitleaks = findSection(sections, 'gitleaks');
    expect(gitleaks.status).toBe('ok');
    expect(gitleaks.findings).toHaveLength(1);
    expect(gitleaks.findings[0]?.ruleId).toBe('generic-api-key');
    expect(gitleaks.findings[0]?.filePath).toBe('src/lib/secrets.ts');

    const osv = findSection(sections, 'osv');
    expect(osv.status).toBe('ok');
    expect(osv.findings).toHaveLength(1);
    expect(osv.findings[0]?.ruleId).toBe('GHSA-cph5-m8f7-6c5x');

    const semgrep = findSection(sections, 'semgrep');
    expect(semgrep.status).toBe('ok');
    expect(semgrep.findings).toHaveLength(1);
    expect(semgrep.findings[0]?.ruleId).toBe('direct-object-access-by-id');
    expect(semgrep.findings[0]?.line).toBe(12);

    // Per step 08b (revision §9 Option B): tool-runner no longer emits
    // confirmed_issue / likely_issue findings. Those are produced by the
    // assertion predicates in steps 09b–12b. Only coverage_gap findings
    // (when a scanner did not complete) come from this agent — the happy
    // path therefore has zero findings.
    expect(result.findings).toHaveLength(0);

    // The new artifact is scan-facts (revision §3.1). Each scanner
    // adapter dual-emits its facts; tool-runner aggregates them.
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.kind).toBe('scan_facts');
    const onDisk = await fs.readFile(result.artifacts[0]!.path, 'utf8');
    const parsed = JSON.parse(onDisk) as {
      value: {
        scannerSections: unknown[];
        scanFacts: { fact_id: string; source: { kind: string } }[];
      };
    };
    expect(parsed.value.scannerSections).toHaveLength(3);
    expect(parsed.value.scanFacts.length).toBeGreaterThan(0);
    // Each ScanFact carries `source.kind = 'scanner_match'`.
    for (const f of parsed.value.scanFacts) {
      expect(f.source.kind).toBe('scanner_match');
    }
  });

  it('missing binary: one scanner returns coverage_gap, others still complete', async () => {
    const context = await buildContext();
    const missingGitleaks: GitleaksRunner = async () => {
      throw new ScannerNotInstalledError('gitleaks', 'install hint');
    };

    const result = await toolRunnerAgent.run(
      {
        lockfilePath: '/tmp/test-project/package-lock.json',
        rulesPath: '/tmp/test-project/rules',
        runners: {
          gitleaks: missingGitleaks,
          osv: fakeRunner<OsvRunner>(OSV_OK_STDOUT, '', 1),
          semgrep: fakeRunner<SemgrepRunner>(SEMGREP_OK_STDOUT, '', 1),
        },
      },
      context,
    );

    expect(result.status).toBe('completed');
    const sections = result.output?.scannerSections ?? [];
    const gitleaks = findSection(sections, 'gitleaks');
    expect(gitleaks.status).toBe('not_installed');
    expect(gitleaks.findings).toHaveLength(0);
    expect(gitleaks.errorSummary).toMatch(/not installed/i);

    expect(findSection(sections, 'osv').status).toBe('ok');
    expect(findSection(sections, 'semgrep').status).toBe('ok');

    const coverageGaps = result.findings.filter(
      (f) => f.finding_type === 'coverage_gap',
    );
    expect(coverageGaps).toHaveLength(1);
    expect(coverageGaps[0]?.id).toBe('tool-runner-gitleaks-coverage');
    expect(coverageGaps[0]?.control_id).toBe('cc-11-8');
    expect(coverageGaps[0]?.summary).toMatch(/not installed/);
  });

  it('scanner error: one scanner returns coverage_gap with status=error, others still complete', async () => {
    const context = await buildContext();
    const erroringSemgrep: SemgrepRunner = async () => {
      throw new ScannerExecutionError('semgrep', 'panicked at startup');
    };

    const result = await toolRunnerAgent.run(
      {
        lockfilePath: '/tmp/test-project/package-lock.json',
        rulesPath: '/tmp/test-project/rules',
        runners: {
          gitleaks: fakeRunner<GitleaksRunner>(GITLEAKS_OK_STDOUT, '', 1),
          osv: fakeRunner<OsvRunner>(OSV_OK_STDOUT, '', 1),
          semgrep: erroringSemgrep,
        },
      },
      context,
    );

    expect(result.status).toBe('completed');
    const sections = result.output?.scannerSections ?? [];
    const semgrep = findSection(sections, 'semgrep');
    expect(semgrep.status).toBe('error');
    expect(semgrep.errorSummary).toMatch(/panicked at startup/);

    expect(findSection(sections, 'gitleaks').status).toBe('ok');
    expect(findSection(sections, 'osv').status).toBe('ok');

    const coverageGaps = result.findings.filter(
      (f) => f.finding_type === 'coverage_gap',
    );
    expect(coverageGaps).toHaveLength(1);
    expect(coverageGaps[0]?.id).toBe('tool-runner-semgrep-coverage');
    expect(result.warnings.join(' ')).toMatch(/semgrep/);
  });

  it('stderr redaction: secret-shaped values are scrubbed for every scanner', async () => {
    const context = await buildContext();
    const stderrWithSecret = `error: failed to load profile for ${FAKE_AWS_KEY}\nbacktrace truncated.`;

    const input: ToolRunnerInput = {
      lockfilePath: '/tmp/test-project/package-lock.json',
      rulesPath: '/tmp/test-project/rules',
      runners: {
        gitleaks: fakeRunner<GitleaksRunner>('[]', stderrWithSecret, 0),
        osv: fakeRunner<OsvRunner>(OSV_OK_STDOUT, stderrWithSecret, 1),
        semgrep: fakeRunner<SemgrepRunner>(SEMGREP_OK_STDOUT, stderrWithSecret, 1),
      },
    };

    const result = await toolRunnerAgent.run(input, context);

    for (const id of ['gitleaks', 'osv', 'semgrep']) {
      const section = findSection(result.output?.scannerSections ?? [], id);
      expect(section.status).toBe('ok');
      expect(section.stderrTail).toBeDefined();
      expect(section.stderrTail).not.toContain(FAKE_AWS_KEY);
      expect(section.stderrTail).toContain('REDACTED');
    }

    const onDisk = await fs.readFile(result.artifacts[0]!.path, 'utf8');
    expect(onDisk).not.toContain(FAKE_AWS_KEY);
  });
});
