import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import {
  NotImplementedError,
  createScanOrchestrator,
  type ScanOrchestrator,
} from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentLogger } from '../types/agent.js';
import { type Result, err, ok } from '../types/result.js';
import {
  defaultReadOnlyEvidencePolicy,
  type EnvironmentType,
  type ValidationMode,
  type ValidationPolicy,
} from '../types/validation-policy.js';

import { CliUsageError } from './errors.js';

const VALIDATION_MODES: readonly ValidationMode[] = [
  'read_only_evidence',
  'sandbox_active_validation',
  'approved_production_safe',
];

const ENVIRONMENTS: readonly EnvironmentType[] = [
  'local',
  'dev',
  'preview',
  'staging',
  'sandbox',
  'production',
];

/**
 * Exact messages the tests in `scan-command.test.ts` assert against. Step 03
 * `Done when:` requires both Phase 2 and later-phase rejections to point at
 * the right plan doc.
 */
export const SANDBOX_REJECTION_MESSAGE =
  '--mode sandbox_active_validation: Phase 2 — not yet implemented (see phases/phase-2/PHASE_2_PLAN.md)';
export const APPROVED_PROD_SAFE_REJECTION_MESSAGE =
  '--mode approved_production_safe: not yet implemented (later phase; see FPP §17 Phase 5)';

/**
 * Shape of the parsed `scan` argv after commander has applied defaults and
 * negations. `ai` follows commander's `--no-ai` convention: default `true`,
 * `false` when the flag is passed.
 */
export interface ScanOptions {
  readonly project: string;
  readonly supabaseSchema?: string;
  readonly out: string;
  readonly json?: string;
  readonly failOnBlocker: boolean;
  readonly mode: string;
  readonly env: string;
  readonly lovableMcp: boolean;
  readonly lovableProject?: string;
  readonly supabaseMcp?: string;
  readonly ai: boolean;
  readonly aiProvider?: string;
}

export interface ValidatedScanInputs {
  readonly projectRoot: string;
  readonly supabaseSchemaPath?: string;
  readonly outPath: string;
  readonly jsonPath?: string;
  readonly failOnBlocker: boolean;
  readonly mode: ValidationMode;
  readonly env: EnvironmentType;
  readonly lovableMcp: boolean;
  readonly lovableProject?: string;
  readonly supabaseMcpProjectRef?: string;
  readonly aiDisabled: boolean;
  readonly aiProvider?: string;
}

export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface ScanCommandDeps {
  readonly stat: (p: string) => Promise<StatLike>;
  readonly orchestratorFactory: () => ScanOrchestrator;
  readonly policyFactory: (env: EnvironmentType) => ValidationPolicy;
  readonly logger: AgentLogger;
  readonly now: () => Date;
  readonly random: () => string;
}

/**
 * Validate parsed argv. Mode and combo checks run before any filesystem I/O
 * so that deferred modes reject without touching the disk
 * (step 03 guardrail: "rejection happens at parse time, BEFORE any agent
 * runs, BEFORE any MCP connection").
 */
export async function validateScanOptions(
  options: ScanOptions,
  deps: Pick<ScanCommandDeps, 'stat'>,
): Promise<Result<ValidatedScanInputs, CliUsageError>> {
  if (!isValidationMode(options.mode)) {
    return err(
      new CliUsageError(
        `--mode "${options.mode}" is not one of: ${VALIDATION_MODES.join(', ')}`,
      ),
    );
  }
  if (options.mode === 'sandbox_active_validation') {
    return err(new CliUsageError(SANDBOX_REJECTION_MESSAGE));
  }
  if (options.mode === 'approved_production_safe') {
    return err(new CliUsageError(APPROVED_PROD_SAFE_REJECTION_MESSAGE));
  }

  if (!isEnvironmentType(options.env)) {
    return err(
      new CliUsageError(
        `--env "${options.env}" is not one of: ${ENVIRONMENTS.join(', ')}`,
      ),
    );
  }

  if (options.lovableMcp && options.lovableProject === undefined) {
    return err(
      new CliUsageError(
        '--lovable-mcp requires --lovable-project <id> (Lovable MCP allowlist denies list_projects; get_project needs an explicit id)',
      ),
    );
  }

  const projectAbs = path.resolve(options.project);
  const projectStat = await safeStat(deps.stat, projectAbs);
  if (projectStat === null) {
    return err(
      new CliUsageError(`--project "${options.project}" does not exist`),
    );
  }
  if (!projectStat.isDirectory()) {
    return err(
      new CliUsageError(`--project "${options.project}" is not a directory`),
    );
  }

  let schemaAbs: string | undefined;
  if (options.supabaseSchema !== undefined) {
    const abs = path.resolve(options.supabaseSchema);
    const s = await safeStat(deps.stat, abs);
    if (s === null) {
      return err(
        new CliUsageError(
          `--supabase-schema "${options.supabaseSchema}" does not exist`,
        ),
      );
    }
    if (!s.isFile()) {
      return err(
        new CliUsageError(
          `--supabase-schema "${options.supabaseSchema}" is not a file`,
        ),
      );
    }
    schemaAbs = abs;
  }

  const validated: ValidatedScanInputs = {
    projectRoot: projectAbs,
    ...(schemaAbs !== undefined ? { supabaseSchemaPath: schemaAbs } : {}),
    outPath: path.resolve(options.out),
    ...(options.json !== undefined
      ? { jsonPath: path.resolve(options.json) }
      : {}),
    failOnBlocker: options.failOnBlocker,
    mode: options.mode,
    env: options.env,
    lovableMcp: options.lovableMcp,
    ...(options.lovableProject !== undefined
      ? { lovableProject: options.lovableProject }
      : {}),
    ...(options.supabaseMcp !== undefined
      ? { supabaseMcpProjectRef: options.supabaseMcp }
      : {}),
    aiDisabled: !options.ai,
    ...(options.aiProvider !== undefined
      ? { aiProvider: options.aiProvider }
      : {}),
  };
  return ok(validated);
}

/**
 * Run a scan. Phase 1 step 03: validates inputs, builds the policy, calls
 * the step-02 orchestrator skeleton. The skeleton throws
 * `NotImplementedError` by design — caught here and treated as expected
 * until step 18 wires real agents.
 *
 * `--fail-on-blocker` is wired through `ValidatedScanInputs.failOnBlocker`
 * but cannot fire yet (no `readiness_status` exists until step 14). It will
 * surface a non-zero exit code once the evidence-report agent lands.
 */
export async function runScan(
  options: ScanOptions,
  deps: ScanCommandDeps,
): Promise<Result<{ readonly exitCode: number }, CliUsageError>> {
  const validated = await validateScanOptions(options, deps);
  if (!validated.ok) {
    return validated;
  }
  const inputs = validated.value;
  const policy = deps.policyFactory(inputs.env);
  const scanId = buildScanId(deps.now(), deps.random());
  const artifactDir = path.join(inputs.projectRoot, '.veyra', 'scans', scanId);

  const context: AgentExecutionContext = {
    scanId,
    projectRoot: inputs.projectRoot,
    artifactDir,
    policy,
    logger: deps.logger,
  };

  const orchestrator = deps.orchestratorFactory();
  try {
    await orchestrator.run(context);
  } catch (e) {
    if (e instanceof NotImplementedError) {
      deps.logger.info(
        'orchestrator runs no agents yet; full wiring lands in phases/phase-1/steps/18-orchestrator-wiring-and-failure-isolation.md',
      );
    } else {
      throw e;
    }
  }

  return ok({ exitCode: 0 });
}

export function buildScanCommand(deps: ScanCommandDeps): Command {
  return new Command('scan')
    .description(
      'Run launch-readiness checks against a local Lovable + Supabase project. Reports which controls were checked, which evidence was found, which was missing, and which issues appear launch-blocking. Phase 1 implements --mode read_only_evidence only; MCP modes are optional and Lovable PAT auth is not supported.',
    )
    .requiredOption('--project <path>', 'path to the Lovable project root')
    .option(
      '--supabase-schema <path>',
      'path to schema SQL exported via supabase db dump',
    )
    .option('--out <path>', 'Markdown report output path', 'veyra-report.md')
    .option('--json <path>', 'JSON report output path')
    .option(
      '--fail-on-blocker',
      'exit non-zero when findings appear launch-blocking (no-op until the report agent lands)',
      false,
    )
    .option(
      '--mode <mode>',
      `validation mode (Phase 1 implements only read_only_evidence): ${VALIDATION_MODES.join(' | ')}`,
      'read_only_evidence',
    )
    .option(
      '--env <type>',
      `environment type: ${ENVIRONMENTS.join(' | ')}`,
      'local',
    )
    .option(
      '--lovable-mcp',
      'enable Lovable MCP connector (optional; requires --lovable-project)',
      false,
    )
    .option(
      '--lovable-project <id>',
      'Lovable project id (required with --lovable-mcp; list_projects is denied by the Phase 1 allowlist)',
    )
    .option(
      '--supabase-mcp <project_ref>',
      'enable Supabase MCP connector with the given project_ref (read_only is derived from --mode)',
    )
    .option('--no-ai', 'disable AI provider entirely (Phase 1 default)')
    .option(
      '--ai-provider <name>',
      'AI provider adapter selection (no provider SDK is wired in Phase 1)',
    )
    .action(async (raw: Record<string, unknown>) => {
      const parsed = parseRawOptions(raw);
      const result = await runScan(parsed, deps);
      if (!result.ok) {
        throw result.error;
      }
    });
}

export function defaultScanCommandDeps(): ScanCommandDeps {
  return {
    stat: (p) => fs.stat(p),
    orchestratorFactory: createScanOrchestrator,
    policyFactory: defaultReadOnlyEvidencePolicy,
    logger: defaultConsoleLogger,
    now: () => new Date(),
    random: () => randomUUID().slice(0, 8),
  };
}

function parseRawOptions(raw: Record<string, unknown>): ScanOptions {
  return {
    project: asString(raw.project) ?? '',
    ...maybeString('supabaseSchema', raw.supabaseSchema),
    out: asString(raw.out) ?? 'veyra-report.md',
    ...maybeString('json', raw.json),
    failOnBlocker: raw.failOnBlocker === true,
    mode: asString(raw.mode) ?? 'read_only_evidence',
    env: asString(raw.env) ?? 'local',
    lovableMcp: raw.lovableMcp === true,
    ...maybeString('lovableProject', raw.lovableProject),
    ...maybeString('supabaseMcp', raw.supabaseMcp),
    ai: raw.ai !== false,
    ...maybeString('aiProvider', raw.aiProvider),
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function maybeString<K extends string>(
  key: K,
  v: unknown,
): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [key]: v } as Partial<Record<K, string>>) : {};
}

function isValidationMode(v: string): v is ValidationMode {
  return (VALIDATION_MODES as readonly string[]).includes(v);
}

function isEnvironmentType(v: string): v is EnvironmentType {
  return (ENVIRONMENTS as readonly string[]).includes(v);
}

async function safeStat(
  stat: (p: string) => Promise<StatLike>,
  p: string,
): Promise<StatLike | null> {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

function buildScanId(now: Date, suffix: string): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${suffix}`;
}

const defaultConsoleLogger: AgentLogger = {
  debug: (msg, fields) => {
    process.stderr.write(formatLog('DEBUG', msg, fields));
  },
  info: (msg, fields) => {
    process.stderr.write(formatLog('INFO', msg, fields));
  },
  warn: (msg, fields) => {
    process.stderr.write(formatLog('WARN', msg, fields));
  },
  error: (msg, fields) => {
    process.stderr.write(formatLog('ERROR', msg, fields));
  },
};

function formatLog(
  level: string,
  msg: string,
  fields: Record<string, unknown> | undefined,
): string {
  const tail =
    fields && Object.keys(fields).length > 0
      ? ` ${JSON.stringify(fields)}`
      : '';
  return `[veyra] ${level} ${msg}${tail}\n`;
}
