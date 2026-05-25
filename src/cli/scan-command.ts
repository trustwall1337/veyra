import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import {
  createDefaultProviderRegistry,
  type ProviderRegistry,
} from '../ai/registry.js';
import {
  NotImplementedError,
  createScanOrchestrator,
  type ScanOrchestrator,
} from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentLogger } from '../types/agent.js';
import type { ProviderId } from '../types/identity.js';
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

const AI_CONCERN_THRESHOLDS = ['low', 'medium', 'high'] as const;
export type AiConcernThreshold = (typeof AI_CONCERN_THRESHOLDS)[number];

const AI_CACHE_TTLS = ['5m', '1h'] as const;
export type AiCacheTtl = (typeof AI_CACHE_TTLS)[number];

const DEFAULT_AI_HYPOTHESIS_BUDGET = 100;
const DEFAULT_AI_CONCERN_THRESHOLD: AiConcernThreshold = 'medium';
const DEFAULT_AI_CACHE_TTL: AiCacheTtl = '5m';
const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';

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
  readonly aiHypothesisBudget?: string;
  readonly aiConcernThreshold?: string;
  readonly aiCacheTtl?: string;
  readonly aiModel?: string;
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
  /**
   * `true` when `--no-ai` was passed OR when AI was not opted into.
   * `--no-ai` is the hard override: it forces AI off even when a key
   * and provider are configured.
   */
  readonly aiDisabled: boolean;
  /**
   * `true` only when ALL three conditions hold:
   *  - `--ai-provider <name>` was passed
   *  - the named provider is registered as `available` in the registry
   *  - the provider's env var (e.g. `ANTHROPIC_API_KEY`) is set
   *  - `--no-ai` was NOT passed
   * Step 18b's orchestrator gates layers 1b, 3, 5 on this flag.
   */
  readonly aiOptIn: boolean;
  /**
   * Provider id as resolved by the registry — `ProviderId`-branded so
   * downstream consumers can't accidentally compare against an
   * unresolved raw string. Populated from `entry.id`, not from the raw
   * argv value, to keep type discipline through the boundary.
   */
  readonly aiProvider?: ProviderId;
  /**
   * Hypothesis-budget cap. Step 08d reads this at AI inference time
   * (per revision §14 Q4). The field name is the seam.
   */
  readonly aiHypothesisBudget: number;
  /**
   * AIConcern visibility threshold. Step 13b's reporter renders only
   * entries at or above this threshold (per revision §14 Q6 + §11).
   * The field name is the seam.
   */
  readonly aiConcernThreshold: AiConcernThreshold;
  readonly aiCacheTtl: AiCacheTtl;
  readonly aiModel: string;
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
  /**
   * Env-var reader. Injected so tests can supply a fake env without
   * mutating the global `process.env` (Vitest test order would otherwise
   * leak state across tests). `defaultScanCommandDeps()` wires this to
   * `process.env[name]`.
   */
  readonly envReader: (name: string) => string | undefined;
  /**
   * Provider registry — resolves `--ai-provider <name>` to an
   * availability record (per FPP §2A). Tests inject custom registries
   * to assert deferred / unknown / available paths without depending on
   * the real Phase 1 entries.
   */
  readonly providerRegistry: ProviderRegistry;
}

/**
 * Validate parsed argv. Mode and combo checks run before any filesystem I/O
 * so that deferred modes reject without touching the disk
 * (step 03 guardrail: "rejection happens at parse time, BEFORE any agent
 * runs, BEFORE any MCP connection").
 */
export async function validateScanOptions(
  options: ScanOptions,
  deps: Pick<ScanCommandDeps, 'stat' | 'envReader' | 'providerRegistry'>,
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

  // Argv-secret guard. Runs BEFORE the registry / env-var checks so a
  // pasted credential never reaches the registry lookup. Scoped to the
  // flags most likely to receive a key (`--ai-provider`, `--ai-model`).
  // Path-shaped flags are exempt to keep the false-positive rate low.
  const argvSecretCheck = checkArgvForRawSecret(options);
  if (argvSecretCheck !== null) {
    return err(new CliUsageError(argvSecretCheck));
  }

  const aiValidation = validateAiOptions(options, deps);
  if (!aiValidation.ok) {
    return aiValidation;
  }
  const ai = aiValidation.value;

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
    aiDisabled: ai.aiDisabled,
    aiOptIn: ai.aiOptIn,
    ...(ai.aiProvider !== undefined ? { aiProvider: ai.aiProvider } : {}),
    aiHypothesisBudget: ai.aiHypothesisBudget,
    aiConcernThreshold: ai.aiConcernThreshold,
    aiCacheTtl: ai.aiCacheTtl,
    aiModel: ai.aiModel,
  };
  return ok(validated);
}

interface AiValidationResult {
  readonly aiDisabled: boolean;
  readonly aiOptIn: boolean;
  readonly aiProvider?: ProviderId;
  readonly aiHypothesisBudget: number;
  readonly aiConcernThreshold: AiConcernThreshold;
  readonly aiCacheTtl: AiCacheTtl;
  readonly aiModel: string;
}

/**
 * Validate the AI-related flags as a group per revision §12b opt-in
 * matrix. The matrix:
 *
 *   no env var, no flag                          → AI skipped silently
 *   env var set, no flag                         → AI skipped silently
 *   no env var, `--ai-provider anthropic`        → reject at parse time
 *   env var + `--ai-provider`                    → AI opted-in
 *   env var + `--ai-provider` + `--no-ai`        → AI skipped (override)
 *
 * Deferred providers (e.g. `--ai-provider openai` in Phase 1) reject
 * with the registry-supplied "not yet implemented" message regardless
 * of env-var state, since the adapter does not exist yet.
 */
function validateAiOptions(
  options: ScanOptions,
  deps: Pick<ScanCommandDeps, 'envReader' | 'providerRegistry'>,
): Result<AiValidationResult, CliUsageError> {
  // Parse and validate the AI knobs first. These are independent of
  // opt-in: even when AI is disabled, the values flow through so the
  // orchestrator can record them in `scan-actions.log`.
  const budgetResult = parseAiHypothesisBudget(options.aiHypothesisBudget);
  if (!budgetResult.ok) {
    return budgetResult;
  }
  const thresholdResult = parseAiConcernThreshold(options.aiConcernThreshold);
  if (!thresholdResult.ok) {
    return thresholdResult;
  }
  const cacheTtlResult = parseAiCacheTtl(options.aiCacheTtl);
  if (!cacheTtlResult.ok) {
    return cacheTtlResult;
  }
  const aiModel =
    options.aiModel !== undefined && options.aiModel.length > 0
      ? options.aiModel
      : DEFAULT_AI_MODEL;

  const knobs = {
    aiHypothesisBudget: budgetResult.value,
    aiConcernThreshold: thresholdResult.value,
    aiCacheTtl: cacheTtlResult.value,
    aiModel,
  };

  // Resolve the provider id (if any). Registry rules:
  //  - unknown id  → reject "not a registered provider" (typo guard;
  //    fires even under `--no-ai` so CI scripts surface real mistakes)
  //  - deferred id → reject with the registry's deferred message,
  //    BUT only when AI is opted-in; `--no-ai` is the hard override
  //    per revision §12b and short-circuits the deferred and env-var
  //    checks (the provider id becomes informational)
  //  - available id → require the env var unless `--no-ai` is set
  if (options.aiProvider !== undefined) {
    const entry = deps.providerRegistry.resolve(options.aiProvider);
    if (entry === undefined) {
      return err(
        new CliUsageError(
          `--ai-provider "${options.aiProvider}" is not a registered provider`,
        ),
      );
    }
    // `--no-ai` hard override: provider id is recorded for audit but
    // no further validation fires (no env-var check, no deferred
    // rejection). The opt-in matrix's bottom row is "env var +
    // provider + --no-ai → AI skipped"; §12b also lets `--no-ai`
    // suppress an unimplemented provider so CI scripts staged for
    // Phase 2 don't break.
    if (!options.ai) {
      return ok({
        aiDisabled: true,
        aiOptIn: false,
        aiProvider: entry.id,
        ...knobs,
      });
    }
    if (entry.availability.kind === 'deferred') {
      return err(new CliUsageError(entry.availability.deferredMessage));
    }
    // Available provider + AI on: env-var must be present.
    const envValue = deps.envReader(entry.availability.envVarName);
    if (envValue === undefined || envValue.length === 0) {
      return err(
        new CliUsageError(
          `--ai-provider ${options.aiProvider}: ${entry.availability.envVarName} not set (AI opt-in requires both --ai-provider and the corresponding env var)`,
        ),
      );
    }
    return ok({
      aiDisabled: false,
      aiOptIn: true,
      aiProvider: entry.id,
      ...knobs,
    });
  }

  // No `--ai-provider` → deterministic baseline. `--no-ai` is allowed
  // and makes `aiDisabled` true; without it the run is also AI-less
  // (no opt-in flag), so `aiOptIn` stays false either way.
  return ok({
    aiDisabled: !options.ai,
    aiOptIn: false,
    ...knobs,
  });
}

function parseAiHypothesisBudget(
  raw: string | undefined,
): Result<number, CliUsageError> {
  if (raw === undefined) {
    return ok(DEFAULT_AI_HYPOTHESIS_BUDGET);
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    return err(
      new CliUsageError(
        `--ai-hypothesis-budget "${raw}" must be a positive integer`,
      ),
    );
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return err(
      new CliUsageError(
        `--ai-hypothesis-budget "${raw}" must be a positive integer`,
      ),
    );
  }
  return ok(n);
}

function parseAiConcernThreshold(
  raw: string | undefined,
): Result<AiConcernThreshold, CliUsageError> {
  if (raw === undefined) {
    return ok(DEFAULT_AI_CONCERN_THRESHOLD);
  }
  if (!isAiConcernThreshold(raw)) {
    return err(
      new CliUsageError(
        `--ai-concern-threshold "${raw}" is not one of: ${AI_CONCERN_THRESHOLDS.join(', ')}`,
      ),
    );
  }
  return ok(raw);
}

function parseAiCacheTtl(
  raw: string | undefined,
): Result<AiCacheTtl, CliUsageError> {
  if (raw === undefined) {
    return ok(DEFAULT_AI_CACHE_TTL);
  }
  if (!isAiCacheTtl(raw)) {
    return err(
      new CliUsageError(
        `--ai-cache-ttl "${raw}" is not one of: ${AI_CACHE_TTLS.join(', ')}`,
      ),
    );
  }
  return ok(raw);
}

function isAiConcernThreshold(v: string): v is AiConcernThreshold {
  return (AI_CONCERN_THRESHOLDS as readonly string[]).includes(v);
}

function isAiCacheTtl(v: string): v is AiCacheTtl {
  return (AI_CACHE_TTLS as readonly string[]).includes(v);
}

/**
 * Scan credential-likely flag values for raw-API-key shapes. Per the
 * step's Constraint 5: "API key read from env var only. Never on argv.
 * CLI rejects keys that look like raw values (entropy + prefix
 * heuristic)." Both legs must agree on the same flag value being
 * suspicious. Path/id flags (`--project`, `--out`, `--json`,
 * `--supabase-schema`, `--lovable-project`, `--supabase-mcp`) are
 * exempt because legitimate values share entropy with credentials.
 */
function checkArgvForRawSecret(options: ScanOptions): string | null {
  const checks: readonly (readonly [string, string | undefined])[] = [
    ['--ai-provider', options.aiProvider],
    ['--ai-model', options.aiModel],
  ];
  for (const [flag, value] of checks) {
    if (value === undefined) continue;
    const reason = classifyRawSecretShape(value);
    if (reason !== null) {
      return `${flag} value looks like a raw API key (${reason}); API keys must be set via environment variable, not argv`;
    }
  }
  return null;
}

const RAW_KEY_PREFIXES: readonly string[] = [
  'sk-ant-',
  'sk-',
  'xoxb-',
  'xoxp-',
  'xoxa-',
  'xoxs-',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'github_pat_',
  'AKIA',
];

/** Returns a short reason string if the value looks like a raw secret, else null. */
function classifyRawSecretShape(value: string): string | null {
  for (const prefix of RAW_KEY_PREFIXES) {
    if (value.startsWith(prefix)) {
      return `prefix "${prefix}"`;
    }
  }
  if (value.length >= 32 && /^[A-Za-z0-9_+=\-]+$/.test(value)) {
    if (shannonEntropy(value) >= 4.0) {
      return `length ${String(value.length)} + high-entropy base64/hex shape`;
    }
  }
  return null;
}

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const len = s.length;
  let h = 0;
  for (const n of counts.values()) {
    const p = n / len;
    h -= p * Math.log2(p);
  }
  return h;
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
      'Run launch-readiness checks against a local Lovable + Supabase project. Reports which controls were checked, which evidence was found, which was missing, and which issues appear launch-blocking. Phase 1 implements --mode read_only_evidence only; MCP modes are optional and Lovable PAT auth is not supported. AI is opt-in: the deterministic baseline runs without any AI flag or env var. Opt-in requires BOTH --ai-provider <name> AND the corresponding env var (ANTHROPIC_API_KEY for anthropic; OPENAI_API_KEY is Phase 2 only). --no-ai is the hard override for CI runs that must not call AI even when opted-in elsewhere.',
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
    .option(
      '--no-ai',
      'hard override that disables AI for this run (skips AI product-understanding, inference, and planning layers even when --ai-provider and the env var are set)',
    )
    .option(
      '--ai-provider <name>',
      'AI provider id (opt-in flag; Phase 1 ships anthropic; openai is Phase 2). Requires the matching env var to be set.',
    )
    .option(
      '--ai-hypothesis-budget <n>',
      `cap on hypotheses produced per scan by the AI inference layer (default ${String(DEFAULT_AI_HYPOTHESIS_BUDGET)})`,
    )
    .option(
      '--ai-concern-threshold <level>',
      `minimum AIConcern confidence to render in the report: ${AI_CONCERN_THRESHOLDS.join(' | ')} (default ${DEFAULT_AI_CONCERN_THRESHOLD})`,
    )
    .option(
      '--ai-cache-ttl <ttl>',
      `prompt-cache TTL for the AI adapter: ${AI_CACHE_TTLS.join(' | ')} (default ${DEFAULT_AI_CACHE_TTL})`,
    )
    .option(
      '--ai-model <model-id>',
      `AI model id passed to the provider adapter (default ${DEFAULT_AI_MODEL})`,
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
    envReader: (name) => process.env[name],
    providerRegistry: createDefaultProviderRegistry(),
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
    ...maybeString('aiHypothesisBudget', raw.aiHypothesisBudget),
    ...maybeString('aiConcernThreshold', raw.aiConcernThreshold),
    ...maybeString('aiCacheTtl', raw.aiCacheTtl),
    ...maybeString('aiModel', raw.aiModel),
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
