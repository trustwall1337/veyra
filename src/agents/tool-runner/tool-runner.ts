/**
 * Tool-runner agent.
 *
 * Wraps the three Phase 1 scanner adapters (gitleaks, OSV, semgrep) in a
 * single agent that:
 *
 *  - runs each scanner under its own try-boundary, so one scanner crashing
 *    or being absent does not abort the whole scan
 *  - normalizes per-scanner outputs into a scanner-agnostic shape
 *  - persists scrubbed stderr alongside findings for audit
 *  - emits a `coverage_gap` Finding for each scanner that could not run
 *
 * Per PHASE_1_PLAN §4.6, this agent does not perform security reasoning
 * beyond classification. Per `CLAUDE.md §Architecture`, it does not import
 * from any sibling `src/agents/*` folder — it communicates only through
 * `context.artifactDir`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { redactSecrets } from '../../scanners/gitleaks/parser.js';
import type {
  GitleaksFinding,
  GitleaksRunner,
} from '../../scanners/gitleaks/types.js';
import { runGitleaks } from '../../scanners/gitleaks/adapter.js';
import type { OsvFinding, OsvRunner } from '../../scanners/osv/types.js';
import { runOsv } from '../../scanners/osv/adapter.js';
import type {
  SemgrepFinding,
  SemgrepRunner,
} from '../../scanners/semgrep/types.js';
import { runSemgrep } from '../../scanners/semgrep/adapter.js';
import type {
  AgentExecutionContext,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import { ScannerNotInstalledError } from '../../types/errors.js';
import type { ScanFact } from '../../types/scan-fact.js';
import type {
  BlastRadius,
  EvidenceStrength,
  Finding,
  FindingType,
  ReviewAction,
} from '../../types/finding.js';
import { asScannerId, type ScannerId } from '../../types/identity.js';
import { isErr, ok, err, type Result } from '../../types/result.js';

import { createDefaultSubprocessRunner } from './runners.js';
import type {
  NormalizedScannerFinding,
  ScannerSection,
  ScannerStatus,
  ToolRunnerInput,
  ToolRunnerOutput,
} from './types.js';

const STDERR_TAIL_BYTES = 4_096;

function mustScannerId(value: string): ScannerId {
  const r = asScannerId(value);
  if (!r.ok) {
    throw new Error(
      `tool-runner: invalid scanner id literal "${value}": ${r.error.message}`,
    );
  }
  return r.value;
}

const GITLEAKS_ID: ScannerId = mustScannerId('gitleaks');
const OSV_ID: ScannerId = mustScannerId('osv');
const SEMGREP_ID: ScannerId = mustScannerId('semgrep');

interface PerScannerClassification {
  readonly finding_type: FindingType;
  readonly evidence_strength: EvidenceStrength;
  readonly review_action: ReviewAction;
  readonly blast_radius: BlastRadius;
  readonly control_id: string;
}

/**
 * Canonical `cc-11-N` control_ids come from `FPP §11`. Step 14 owns the
 * authoritative catalog; the ids below are the ones FPP §11 already pins
 * to specific scanners:
 *
 *  - row 8  → `cc-11-8`  (Hardcoded API key / Supabase service-role key
 *                          in source, Gitleaks-detectable)
 *  - row 10 → `cc-11-10` (Vulnerable dependency in package.json,
 *                          OSV-detectable)
 *
 * Semgrep is a special case: its rules cover multiple `cc-11-N` rows
 * (see each YAML rule's `metadata.control_id` under the `rules/` tree).
 * Per-hit control_id is parsed from the rule's `metadata` or, as a
 * stopgap, from the `cc-11-N` prefix the rules embed in their `message`.
 * For the scanner-missing coverage_gap, the agent emits one finding
 * tagged with a representative semgrep-covered control (`cc-11-3`) and
 * the summary notes that semgrep covers several controls.
 */
const CLASSIFICATION: ReadonlyMap<ScannerId, PerScannerClassification> =
  new Map<ScannerId, PerScannerClassification>([
    [
      GITLEAKS_ID,
      {
        // Gitleaks is direct deterministic evidence per `FPP §11` row 8.
        finding_type: 'confirmed_issue',
        evidence_strength: 'high',
        review_action: 'fix_before_launch',
        blast_radius: 'secrets',
        control_id: 'cc-11-8',
      },
    ],
    [
      OSV_ID,
      {
        // Step 06 Guardrails: dependency findings are launch-readiness
        // signals, never `confirmed_issue` — presence ≠ exploitable.
        finding_type: 'likely_issue',
        evidence_strength: 'medium',
        review_action: 'review_before_launch',
        blast_radius: 'unknown',
        control_id: 'cc-11-10',
      },
    ],
    [
      SEMGREP_ID,
      {
        // Step 08 Guardrails: semgrep hits default to non-confirmed. The
        // control_id below is the placeholder used for coverage_gap when
        // the whole scanner did not run; per-hit findings parse their own
        // `cc-11-N` from the rule message and override this default.
        // TODO(step-14): rows FPP §11 row 7 (`cc-11-7`) and row 8
        // (`cc-11-8-supplementary`) are classified `confirmed_issue` in
        // the catalog. The promotion happens in the report agent (step
        // 14), not here — step 08 stays "default to non-confirmed".
        finding_type: 'likely_issue',
        evidence_strength: 'medium',
        review_action: 'review_before_launch',
        blast_radius: 'unknown',
        control_id: 'cc-11-3',
      },
    ],
  ]);

/**
 * Veyra semgrep rules embed their `cc-11-N` control_id in the leading
 * token of `message:` (convention enforced by every rule in `rules/`).
 * This stopgap parses that prefix so per-hit findings can carry the
 * right id without the SemgrepFinding type having to surface
 * `metadata.control_id` — surfacing metadata is a step 07 change and
 * would expand step 08's scope. Step 14 may switch to metadata-based
 * resolution when it canonicalizes the catalog.
 */
const CC_11_PREFIX = /^(cc-11-\d+(?:-[a-z][a-z0-9-]*)?)\b/;

function controlIdFromSemgrepMessage(
  message: string,
  fallback: string,
): string {
  const match = CC_11_PREFIX.exec(message);
  if (match === null) return fallback;
  return match[1] ?? fallback;
}

function classificationFor(scannerId: ScannerId): PerScannerClassification {
  const c = CLASSIFICATION.get(scannerId);
  if (c === undefined) {
    throw new Error(`tool-runner: no classification for scanner "${scannerId}"`);
  }
  return c;
}

function normalizeGitleaks(f: GitleaksFinding): NormalizedScannerFinding {
  return {
    ruleId: f.ruleId,
    title: f.description.length > 0 ? f.description : f.ruleId,
    filePath: f.filePath,
    line: f.line,
  };
}

function normalizeOsv(f: OsvFinding): NormalizedScannerFinding {
  const title =
    f.summary.length > 0 ? f.summary : `${f.packageName}@${f.packageVersion}`;
  return {
    ruleId: f.vulnerabilityId,
    title,
    ...(f.severity !== undefined ? { severity: f.severity } : {}),
  };
}

function normalizeSemgrep(f: SemgrepFinding): NormalizedScannerFinding {
  return {
    ruleId: f.ruleId,
    title: f.message,
    filePath: f.filePath,
    line: f.startLine,
    severity: f.severity,
  };
}

function tailString(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return value.slice(value.length - maxBytes);
}

function scrubStderrForArtifact(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return redactSecrets(tailString(trimmed, STDERR_TAIL_BYTES));
}

interface ScannerInvocation<TError> {
  readonly scannerId: ScannerId;
  readonly stderrTail: string | undefined;
  readonly outcome:
    | { kind: 'ok'; findings: readonly NormalizedScannerFinding[] }
    | { kind: 'not_installed'; message: string }
    | { kind: 'error'; message: string }
    | { kind: 'thrown'; message: string };
  readonly errorClass?: TError;
}

function buildSection<TError>(inv: ScannerInvocation<TError>): ScannerSection {
  const base = {
    scannerId: inv.scannerId,
    findings:
      inv.outcome.kind === 'ok' ? inv.outcome.findings : ([] as const),
    ...(inv.stderrTail !== undefined ? { stderrTail: inv.stderrTail } : {}),
  };

  if (inv.outcome.kind === 'ok') {
    return { ...base, status: 'ok' };
  }
  const status: ScannerStatus =
    inv.outcome.kind === 'not_installed' ? 'not_installed' : 'error';
  return { ...base, status, errorSummary: inv.outcome.message };
}

/**
 * Wrap any structurally-compatible runner so the caller can observe stderr
 * after the run, without changing the adapter's call signature.
 *
 * All three scanner-runner types (`GitleaksRunner`, `OsvRunner`,
 * `SemgrepRunner`) share the same shape, so one helper covers all three.
 */
function wrapWithStderrCapture<
  R extends (
    binary: string,
    args: readonly string[],
    opts: { timeoutMs: number },
  ) => Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number | null;
  }>,
>(base: R): { runner: R; getStderr: () => string } {
  let captured = '';
  const wrapped = (async (binary, args, opts) => {
    const result = await base(binary, args, opts);
    captured = result.stderr;
    return result;
  }) as R;
  return {
    runner: wrapped,
    getStderr: () => captured,
  };
}

interface SectionResult {
  readonly section: ScannerSection;
  readonly facts: readonly import('../../types/scan-fact.js').ScanFact[];
}

async function runGitleaksSection(
  projectPath: string,
  injected: GitleaksRunner | undefined,
): Promise<SectionResult> {
  const baseRunner: GitleaksRunner =
    injected ?? createDefaultSubprocessRunner();
  const capture = wrapWithStderrCapture(baseRunner);

  try {
    const result = await runGitleaks({ projectPath }, capture.runner);
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    if (isErr(result)) {
      const err = result.error;
      if (err instanceof ScannerNotInstalledError) {
        return {
          section: buildSection({
            scannerId: GITLEAKS_ID,
            stderrTail,
            outcome: { kind: 'not_installed', message: err.message },
          }),
          facts: [],
        };
      }
      return {
        section: buildSection({
          scannerId: GITLEAKS_ID,
          stderrTail,
          outcome: { kind: 'error', message: err.message },
        }),
        facts: [],
      };
    }
    return {
      section: buildSection({
        scannerId: GITLEAKS_ID,
        stderrTail,
        outcome: {
          kind: 'ok',
          findings: result.value.findings.map(normalizeGitleaks),
        },
      }),
      facts: result.value.facts,
    };
  } catch (e) {
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    const message = e instanceof Error ? e.message : String(e);
    return {
      section: buildSection({
        scannerId: GITLEAKS_ID,
        stderrTail,
        outcome: { kind: 'error', message },
      }),
      facts: [],
    };
  }
}

async function runOsvSection(
  lockfilePath: string | undefined,
  injected: OsvRunner | undefined,
): Promise<SectionResult> {
  if (lockfilePath === undefined) {
    return {
      section: buildSection({
        scannerId: OSV_ID,
        stderrTail: undefined,
        outcome: {
          kind: 'error',
          message:
            'lockfile path was missing; the dependency check was not performed',
        },
      }),
      facts: [],
    };
  }
  const baseRunner: OsvRunner =
    injected ?? createDefaultSubprocessRunner();
  const capture = wrapWithStderrCapture(baseRunner);

  try {
    const result = await runOsv({ lockfilePath }, capture.runner);
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    if (isErr(result)) {
      const err = result.error;
      if (err instanceof ScannerNotInstalledError) {
        return {
          section: buildSection({
            scannerId: OSV_ID,
            stderrTail,
            outcome: { kind: 'not_installed', message: err.message },
          }),
          facts: [],
        };
      }
      return {
        section: buildSection({
          scannerId: OSV_ID,
          stderrTail,
          outcome: { kind: 'error', message: err.message },
        }),
        facts: [],
      };
    }
    return {
      section: buildSection({
        scannerId: OSV_ID,
        stderrTail,
        outcome: {
          kind: 'ok',
          findings: result.value.findings.map(normalizeOsv),
        },
      }),
      facts: result.value.facts,
    };
  } catch (e) {
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    const message = e instanceof Error ? e.message : String(e);
    return {
      section: buildSection({
        scannerId: OSV_ID,
        stderrTail,
        outcome: { kind: 'error', message },
      }),
      facts: [],
    };
  }
}

async function runSemgrepSection(
  projectPath: string,
  rulesPath: string | undefined,
  injected: SemgrepRunner | undefined,
): Promise<SectionResult> {
  if (rulesPath === undefined) {
    return {
      section: buildSection({
        scannerId: SEMGREP_ID,
        stderrTail: undefined,
        outcome: {
          kind: 'error',
          message:
            'rules directory was missing; the static-analysis check was not performed',
        },
      }),
      facts: [],
    };
  }
  const baseRunner: SemgrepRunner =
    injected ?? createDefaultSubprocessRunner();
  const capture = wrapWithStderrCapture(baseRunner);

  try {
    const result = await runSemgrep(
      { projectPath, rulesPath },
      capture.runner,
    );
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    if (isErr(result)) {
      const err = result.error;
      if (err instanceof ScannerNotInstalledError) {
        return {
          section: buildSection({
            scannerId: SEMGREP_ID,
            stderrTail,
            outcome: { kind: 'not_installed', message: err.message },
          }),
          facts: [],
        };
      }
      return {
        section: buildSection({
          scannerId: SEMGREP_ID,
          stderrTail,
          outcome: { kind: 'error', message: err.message },
        }),
        facts: [],
      };
    }
    return {
      section: buildSection({
        scannerId: SEMGREP_ID,
        stderrTail,
        outcome: {
          kind: 'ok',
          findings: result.value.findings.map(normalizeSemgrep),
        },
      }),
      facts: result.value.facts,
    };
  } catch (e) {
    const stderrTail = scrubStderrForArtifact(capture.getStderr());
    const message = e instanceof Error ? e.message : String(e);
    return {
      section: buildSection({
        scannerId: SEMGREP_ID,
        stderrTail,
        outcome: { kind: 'error', message },
      }),
      facts: [],
    };
  }
}

function coverageGapFinding(section: ScannerSection): Finding {
  const cls = classificationFor(section.scannerId);
  const reason =
    section.status === 'not_installed'
      ? `${section.scannerId} is not installed on this machine`
      : `${section.scannerId} did not complete (${section.errorSummary ?? 'unknown error'})`;
  const coverageNote =
    section.scannerId === SEMGREP_ID
      ? ' Semgrep covers multiple cc-11 controls (cc-11-2 / cc-11-3 / cc-11-4 / cc-11-7); this finding is tagged with the representative id.'
      : '';
  return {
    id: `tool-runner-${section.scannerId}-coverage`,
    control_id: cls.control_id,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'tool_output',
    review_action: 'review_before_launch',
    blast_radius: cls.blast_radius,
    title: `${section.scannerId} check was not performed`,
    summary: `${reason}; this control was not checked and needs human review.${coverageNote}`,
    evidence_refs: [],
  };
}

function evidenceRefFor(
  scannerId: ScannerId,
  finding: NormalizedScannerFinding,
): string {
  const filePart = finding.filePath ?? '<no-file>';
  const linePart = finding.line !== undefined ? String(finding.line) : '0';
  return `${scannerId}:${finding.ruleId}:${filePart}:${linePart}`;
}

function controlIdForHit(
  scannerId: ScannerId,
  finding: NormalizedScannerFinding,
  fallback: string,
): string {
  if (scannerId === SEMGREP_ID) {
    return controlIdFromSemgrepMessage(finding.title, fallback);
  }
  return fallback;
}

function scannerFinding(
  scannerId: ScannerId,
  finding: NormalizedScannerFinding,
  index: number,
): Finding {
  const cls = classificationFor(scannerId);
  const where =
    finding.filePath !== undefined
      ? finding.line !== undefined
        ? ` at ${finding.filePath}:${String(finding.line)}`
        : ` in ${finding.filePath}`
      : '';
  return {
    id: `tool-runner-${scannerId}-${String(index)}`,
    control_id: controlIdForHit(scannerId, finding, cls.control_id),
    finding_type: cls.finding_type,
    evidence_strength: cls.evidence_strength,
    reproducibility: 'tool_output',
    review_action: cls.review_action,
    blast_radius: cls.blast_radius,
    title: finding.title,
    summary: `${scannerId} rule ${finding.ruleId} matched${where}; needs human review.`,
    evidence_refs: [evidenceRefFor(scannerId, finding)],
  };
}

/**
 * Step 08b migration (clean break, AI-shape revision §9 Option B):
 * tool-runner stops emitting `confirmed_issue` / `likely_issue` findings.
 * Only `coverage_gap` findings are emitted (when a scanner did not
 * complete). All other Finding emission lives in the assertion layer
 * (09b–12b). The `ScanFact[]` aggregated from each scanner adapter is
 * the new observation artifact (`scan_facts`).
 */
function findingsForSection(section: ScannerSection): Finding[] {
  if (section.status !== 'ok') {
    return [coverageGapFinding(section)];
  }
  return [];
}

// Functions retained for reference but unused after the 08b migration.
// Each scanner adapter now produces `ScanFact[]` directly; the
// assertion predicates (09b–12b) build Finding objects from those
// facts. Keeping the helpers as unused suppresses dead-code style
// churn in step 14 where coverage_gap classification still references
// the per-scanner classification table.
void scannerFinding;
void evidenceRefFor;
void controlIdForHit;

export const SCAN_FACTS_ARTIFACT_NAME = 'scan-facts.json';

/**
 * Persist `{ scan_facts: ScanFact[] }` to `<artifactDir>/scan-facts.json`
 * (no extra `scanId` segment, no `Artifact<T>` wrapper). Returns an
 * `ArtifactRef` pointing at the written file.
 *
 * The shape consumed by every downstream predicate is the bare
 * `{ scan_facts: [...] }` JSON — see e.g.
 * `src/agents/authn/agent.ts::readScanFacts` and
 * `src/agents/ai-inference/agent.ts::readScanFacts`, both of which
 * read `parsed.scan_facts`, not `parsed.value.scan_facts`.
 */
export async function writeScanFactsArtifact(
  artifactDir: string,
  scanId: string,
  scanFacts: readonly ScanFact[],
): Promise<Result<ArtifactRef, Error>> {
  const filePath = path.join(artifactDir, SCAN_FACTS_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    // Step 21 retro f4: preserve the artifact-store's append-only
    // invariant — refuse to overwrite an existing scan-facts.json
    // within the same scan directory. A duplicate write within one
    // scan id is always a caller bug.
    await fs.writeFile(
      filePath,
      JSON.stringify({ scan_facts: scanFacts }, null, 2),
      { flag: 'wx' },
    );
    return ok({ scanId, kind: 'scan_facts', path: filePath });
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new Error(`failed to write ${filePath}: ${m}`));
  }
}

export const toolRunnerAgent: VeyraAgent<ToolRunnerInput, ToolRunnerOutput> = {
  metadata: {
    id: 'tool-runner',
    version: '0.1.0',
    declared_dependencies: [],
    produces: ['scan-facts.json'],
  },

  async run(
    input: ToolRunnerInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<ToolRunnerOutput>> {
    const sectionResults = await Promise.all([
      runGitleaksSection(context.projectRoot, input.runners?.gitleaks),
      runOsvSection(input.lockfilePath, input.runners?.osv),
      runSemgrepSection(
        context.projectRoot,
        input.rulesPath,
        input.runners?.semgrep,
      ),
    ]);

    const sections = sectionResults.map((sr) => sr.section);
    const scanFacts = sectionResults.flatMap((sr) => Array.from(sr.facts));
    const output: ToolRunnerOutput = {
      scannerSections: sections,
      scanFacts,
    };

    const findings: Finding[] = [];
    const warnings: string[] = [];
    for (const section of sections) {
      findings.push(...findingsForSection(section));
      if (section.status !== 'ok') {
        warnings.push(
          `${section.scannerId} status=${section.status}: ${section.errorSummary ?? 'no detail'}`,
        );
      }
    }

    // Per step 21 Bug 1: write `scan-facts.json` directly into
    // `context.artifactDir` (which the CLI already constructs as
    // `<projectRoot>/.veyra/scans/<scanId>/`). Using
    // `createFsArtifactStore(context.artifactDir).write(context.scanId, ...)`
    // doubled the scanId in the path AND wrapped the value in an
    // Artifact<T> envelope that consumer predicates do not parse.
    // The bare `{ scan_facts: [...] }` shape below matches what
    // every consumer (authn / authz-tenant / supabase-rls /
    // business-logic / ai-inference) already reads via
    // `parsed.scan_facts`. Per revision §3.1 + step 08b the durable
    // artifact carries facts only — no wrapper.
    const writeResult = await writeScanFactsArtifact(
      context.artifactDir,
      context.scanId,
      scanFacts,
    );

    const artifacts: ArtifactRef[] = [];
    if (writeResult.ok) {
      artifacts.push(writeResult.value);
    } else {
      warnings.push(
        `failed to persist scan_facts artifact: ${writeResult.error.message}`,
      );
    }

    return {
      status: 'completed',
      output,
      artifacts,
      findings,
      warnings,
    };
  },
};
