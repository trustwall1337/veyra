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
import {
  bundledRulesDir,
  discoverLockfile,
  registerPhase1Agents,
} from './agent-registration.js';
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
/**
 * Step 2.11 retro: Mode B parse-time rejection is REMOVED. Mode B is
 * now gated by --approve-active + --supabase-sandbox +
 * --supabase-service-role-key (+ --ci --approval-file in CI). The
 * old SANDBOX_REJECTION_MESSAGE stays exported for back-compat with
 * any test that asserts on the string; the new flow's message
 * surfaces when the required Mode B flags are missing.
 */
export const SANDBOX_REJECTION_MESSAGE =
  '--mode sandbox_active_validation: Phase 2 — not yet implemented (see phases/phase-2/PHASE_2_PLAN.md)';
export const MODE_B_MISSING_APPROVE_MESSAGE =
  '--mode sandbox_active_validation requires --approve-active (and --ci + --approval-file in CI mode). Re-run with --approve-active to acknowledge that synthetic data will be created in the sandbox project.';
export const MODE_B_MISSING_SANDBOX_MESSAGE =
  '--mode sandbox_active_validation requires --supabase-sandbox <project_ref> to identify the sandbox project. Production environments are rejected at the policy factory boundary.';
export const MODE_B_CI_MISSING_APPROVAL_MESSAGE =
  '--ci requires --approval-file <path>. CI runs cannot prompt for interactive confirmation; supply a signed approval file per phases/phase-2/decisions.md decision 5.';
export const APPROVED_PROD_SAFE_REJECTION_MESSAGE =
  '--mode approved_production_safe: not yet implemented (later phase; see FPP §17 Phase 5)';

/**
 * Step 27: legacy customer-facing flags are removed from the customer
 * surface. They reject at parse-time with explicit migration messages
 * so callers see a clear path forward (not a silent no-op). Done-When
 * #5 + #6 + the dev-flag double-gate.
 */
export const SUPABASE_MCP_DEPRECATED_MESSAGE =
  '--supabase-mcp is deprecated. Use --supabase <project_ref> for the REST default. For the MCP backend (alternative), set VEYRA_DEV=1 and use --dev-supabase-backend supabase-mcp.';
export const LOVABLE_MCP_DEFERRED_MESSAGE =
  '--lovable-mcp requires a Lovable OAuth client; this is deferred to Phase 1 step 28. For Lovable in Phase 1, read code from a local git clone of your Lovable project\'s GitHub repo.';
export const SUPABASE_SCHEMA_DEPRECATED_MESSAGE =
  '--supabase-schema is a developer-only flag now. Set VEYRA_DEV=1 and pass --dev-supabase-schema <path> instead. Customer scans use --supabase <project_ref> (the REST default).';
export const DEV_FLAG_GATE_MESSAGE_PREFIX =
  'developer-only flag requires VEYRA_DEV=1 in the environment:';

/**
 * Allowed customer-facing data-source backend ids. The customer flag
 * `--supabase <ref>` resolves to `supabase-rest`. Dev flag
 * `--dev-supabase-backend <id>` accepts any registered id but the
 * customer-default remains REST.
 */
export const CUSTOMER_DEFAULT_SUPABASE_BACKEND = 'supabase-rest';

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
  /**
   * Step 27 customer-facing flag: `--supabase <project_ref>`. Selects
   * the REST backend by default. Reads `SUPABASE_ACCESS_TOKEN` from the
   * environment via `deps.envReader`.
   */
  readonly supabase?: string;
  /**
   * Step 27 dev-only flag: `--dev-supabase-backend <id>`. Requires
   * `VEYRA_DEV=1` (double-gate per Q4). Accepts any registered
   * `DataSourceId`; common values: `supabase-rest` (default), `supabase-mcp`.
   */
  readonly devSupabaseBackend?: string;
  /**
   * Step 27 dev-only flag: `--dev-supabase-schema <path>`. Replaces the
   * legacy customer-facing `--supabase-schema`. Requires `VEYRA_DEV=1`.
   */
  readonly devSupabaseSchema?: string;
  // Step 2.11 codex retro: Mode B flags.
  readonly supabaseSandbox?: string;
  readonly supabaseServiceRoleKey?: string;
  readonly approveActive?: boolean;
  readonly ci?: boolean;
  readonly approvalFile?: string;
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
   * Step 27: customer-facing `--supabase <project_ref>`. When set, the
   * CLI builds the REST-backed `DatabaseMetadataSource` +
   * `StorageMetadataSource` and passes them to agent-registration. The
   * access token rides only in the Authorization header (CLAUDE.md
   * §Secrets); the project_ref is the only argv-visible identifier.
   */
  readonly supabaseProjectRef?: string;
  /**
   * Step 27 dev-only: resolved `--dev-supabase-backend <id>` value when
   * `VEYRA_DEV=1` is set. Defaults to `undefined` for customer-default
   * REST. When set, the runScan path uses this id to pick the backend.
   */
  readonly devSupabaseBackend?: string;
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
  /**
   * Step 23 retro-f1: optional scanner-runner overrides for the
   * tool-runner agent. Production callers leave this undefined and
   * the tool-runner falls back to its default `spawn`-based runners.
   * The end-to-end fixture gate injects mocks that emit fixture-shape
   * JSON deterministically, so Bug C / Bug D regressions are caught
   * regardless of which scanner binaries are installed on the dev /
   * CI machine.
   */
  readonly scannerRunnersOverride?: {
    readonly gitleaks?: import('../scanners/gitleaks/types.js').GitleaksRunner;
    readonly osv?: import('../scanners/osv/types.js').OsvRunner;
    readonly semgrep?: import('../scanners/semgrep/types.js').SemgrepRunner;
  };
  /**
   * Step 24: optional Supabase MCP transport factory. Production
   * callers leave this undefined and `createDefaultSupabaseTransport`
   * is used (which reads the access-token from the injected
   * `envReader` and is a fail-closed Phase 1 stub). The end-to-end
   * fixture gate injects a mock transport that replays recorded
   * Supabase MCP responses from `examples/.../mcp-fixtures/`.
   */
  readonly supabaseTransportFactory?: (options: {
    readonly projectRef: string;
    readonly accessToken: string;
  }) => import('../connectors/supabase/client.js').SupabaseTransport;
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
    // Codex retro 2.11-mode-b-still-rejected: Mode B is no longer
    // parse-rejected. The gates below land Mode B's preconditions
    // at the same boundary as Phase 1's deferred-mode rejections.
    if (!options.approveActive) {
      return err(new CliUsageError(MODE_B_MISSING_APPROVE_MESSAGE));
    }
    if (
      options.supabaseSandbox === undefined ||
      options.supabaseSandbox.length === 0
    ) {
      return err(new CliUsageError(MODE_B_MISSING_SANDBOX_MESSAGE));
    }
    // The service-role key flag carries the NAME of an env var only.
    // Refuse anything that looks like a key value, and require
    // SHOUTY_CASE shape.
    if (
      options.supabaseServiceRoleKey !== undefined &&
      options.supabaseServiceRoleKey.length > 0
    ) {
      const modB = await import('./mode-b.js');
      if (modB.looksLikeKeyValue(options.supabaseServiceRoleKey)) {
        return err(
          new CliUsageError(
            '--supabase-service-role-key takes the NAME of an env var, not the key value. Set the env var (e.g. VEYRA_TEST_SRK) and pass --supabase-service-role-key VEYRA_TEST_SRK.',
          ),
        );
      }
      if (!modB.isValidEnvVarName(options.supabaseServiceRoleKey)) {
        return err(
          new CliUsageError(
            `--supabase-service-role-key expects a SHOUTY_CASE env-var NAME; got "${options.supabaseServiceRoleKey}"`,
          ),
        );
      }
    }
    if (options.ci && options.approvalFile === undefined) {
      return err(new CliUsageError(MODE_B_CI_MISSING_APPROVAL_MESSAGE));
    }
    // CI flow: read + check the approval file (signature verification
    // remains a stub deferred to the minisign-library landing).
    if (options.ci && options.approvalFile !== undefined) {
      const modB = await import('./mode-b.js');
      const af = await modB.readApprovalFile(options.approvalFile);
      if (!af.ok) {
        return err(new CliUsageError(af.error.message));
      }
      const gate = await modB.checkApprovalAndConsume({
        approvalFilePath: options.approvalFile,
        approvalFile: af.value,
        supabaseSandboxRef: options.supabaseSandbox,
        now: new Date(),
      });
      if (!gate.ok) {
        return err(new CliUsageError(gate.error.message));
      }
    }
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

  // Step 27 Done-When #6: --lovable-mcp is removed from the customer
  // surface. Lovable's MCP server uses OAuth from inside the calling
  // MCP client only; Veyra has no OAuth client in Phase 1. Reject at
  // parse-time with the explicit step-28-deferred message.
  if (options.lovableMcp) {
    return err(new CliUsageError(LOVABLE_MCP_DEFERRED_MESSAGE));
  }

  // Step 27 Done-When #5: legacy --supabase-mcp rejects at parse-time
  // with the migration message. The MCP backend is reachable only via
  // VEYRA_DEV=1 + --dev-supabase-backend supabase-mcp. No silent
  // fall-through, no no-op, no "did the flag run?" ambiguity.
  if (options.supabaseMcp !== undefined) {
    return err(new CliUsageError(SUPABASE_MCP_DEPRECATED_MESSAGE));
  }

  // Step 27: legacy customer-facing --supabase-schema is deprecated.
  // Customers use --supabase <project_ref>; contributors testing
  // against a local pg_dump use --dev-supabase-schema with VEYRA_DEV=1.
  if (options.supabaseSchema !== undefined) {
    return err(new CliUsageError(SUPABASE_SCHEMA_DEPRECATED_MESSAGE));
  }

  // Step 27 Done-When #8: developer flags require VEYRA_DEV=1 in the
  // environment AND the --dev- prefix. Two locks together so a single
  // accidental copy-paste from a contributor's terminal does not
  // activate them in customer use.
  const veyraDev = deps.envReader('VEYRA_DEV') === '1';
  if (options.devSupabaseBackend !== undefined && !veyraDev) {
    return err(
      new CliUsageError(
        `${DEV_FLAG_GATE_MESSAGE_PREFIX} --dev-supabase-backend (set VEYRA_DEV=1 in the shell)`,
      ),
    );
  }
  if (options.devSupabaseSchema !== undefined && !veyraDev) {
    return err(
      new CliUsageError(
        `${DEV_FLAG_GATE_MESSAGE_PREFIX} --dev-supabase-schema (set VEYRA_DEV=1 in the shell)`,
      ),
    );
  }

  // --supabase <project_ref>: customer flag. Validate the project_ref
  // shape before any I/O so a typo surfaces immediately.
  if (options.supabase !== undefined) {
    if (!/^[a-z0-9]{16,32}$/.test(options.supabase)) {
      return err(
        new CliUsageError(
          `--supabase project_ref must be 16–32 lowercase alphanumerics; got "${options.supabase}"`,
        ),
      );
    }
  }
  // --dev-supabase-backend requires --supabase to identify the project.
  // Without it, there is no project_ref to point the alternative
  // backend at.
  if (
    options.devSupabaseBackend !== undefined &&
    options.supabase === undefined
  ) {
    return err(
      new CliUsageError(
        '--dev-supabase-backend requires --supabase <project_ref> to identify the project',
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
  if (options.devSupabaseSchema !== undefined) {
    const abs = path.resolve(options.devSupabaseSchema);
    const s = await safeStat(deps.stat, abs);
    if (s === null) {
      return err(
        new CliUsageError(
          `--dev-supabase-schema "${options.devSupabaseSchema}" does not exist`,
        ),
      );
    }
    if (!s.isFile()) {
      return err(
        new CliUsageError(
          `--dev-supabase-schema "${options.devSupabaseSchema}" is not a file`,
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
    ...(options.supabase !== undefined
      ? { supabaseProjectRef: options.supabase }
      : {}),
    ...(options.devSupabaseBackend !== undefined
      ? { devSupabaseBackend: options.devSupabaseBackend }
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
  // Step 23 Bug C + Bug D: auto-discover the bundled `rules/` and any
  // lockfile under projectRoot so semgrep + OSV adapters get the
  // inputs they need without the customer passing extra flags.
  const discoveredLockfile = await discoverLockfile(inputs.projectRoot);

  // Step 28a codex df1: register the local-clone CodeSource so
  // resolveDataSource(lovableGithubCloneId) resolves at runtime.
  // Production code paths can then route through the registry once
  // step 28b wires the Lovable MCP CodeSource alongside it. The call
  // is idempotent — the registry rejects double-register, which we
  // tolerate (each scan invocation gets a fresh check).
  try {
    const lgcMod = await import('../data-sources/lovable-github-clone/index.js');
    lgcMod.registerLovableGithubClone();
  } catch {
    // already registered in this process — registry is module-scoped.
  }

  // Step 27: select Supabase data-source backend.
  //   - Customer default: --supabase <project_ref> → REST backend.
  //   - Dev-gated alternative: --supabase <ref> + VEYRA_DEV=1 +
  //     --dev-supabase-backend supabase-mcp → MCP backend.
  //   - Dev-gated SQL file: --dev-supabase-schema <path> (parsed by
  //     supabase-rls's existing sql_file path; no backend wiring).
  //
  // The legacy customer-facing --supabase-mcp flag is rejected at
  // parse-time with SUPABASE_MCP_DEPRECATED_MESSAGE (Done-When #5).
  let supabaseMcpClient: import('../connectors/supabase/client.js').SupabaseClient | undefined;
  let supabaseMcpTransport:
    | import('../connectors/supabase/client.js').SupabaseTransport
    | undefined;
  let supabaseRestSources:
    | {
        readonly projectRef: string;
        readonly database: import('../types/data-sources.js').DatabaseMetadataSource;
        readonly storage: import('../types/data-sources.js').StorageMetadataSource;
      }
    | undefined;
  if (inputs.supabaseProjectRef !== undefined) {
    const accessToken = deps.envReader('SUPABASE_ACCESS_TOKEN') ?? '';
    if (accessToken.length === 0) {
      return {
        ok: false,
        error: new CliUsageError(
          '--supabase requires SUPABASE_ACCESS_TOKEN in the environment. Set the env var and retry; the value never appears on argv or in any artifact per CLAUDE.md §Secrets.',
        ),
      };
    }
    // Step 27 codex step27-df5: resolve the backend through the
    // data-source registry rather than hardcoding a `'supabase-rest' |
    // 'supabase-mcp'` switch (FPP §2A forbids closed unions on service
    // identity in shared code). Backends register themselves at module
    // load; the CLI looks up the requested id and constructs the
    // capability adapters from the registered factories.
    const backendStr = inputs.devSupabaseBackend ?? CUSTOMER_DEFAULT_SUPABASE_BACKEND;
    const { asDataSourceId } = await import('../types/data-sources.js');
    const idR = asDataSourceId(backendStr);
    if (!idR.ok) {
      return {
        ok: false,
        error: new CliUsageError(
          `--dev-supabase-backend "${backendStr}" is not a valid DataSourceId: ${idR.error.message}`,
        ),
      };
    }
    // Lazily ensure backend modules are registered (idempotent —
    // registry rejects double-register, so wrap in try/catch).
    const { resolveDataSource } = await import('../data-sources/registry.js');
    const restMod = await import('../data-sources/supabase-rest/index.js');
    const mcpMod = await import('../data-sources/supabase-mcp/index.js');
    try { restMod.registerSupabaseRest(); } catch { /* already registered */ }
    try { mcpMod.registerSupabaseMcp(); } catch { /* already registered */ }

    const reg = resolveDataSource(idR.value);
    if (reg === undefined) {
      return {
        ok: false,
        error: new CliUsageError(
          `--dev-supabase-backend "${backendStr}" is not a registered Supabase data-source backend`,
        ),
      };
    }

    if (reg.id === restMod.supabaseRestId) {
      // REST default — no subprocess, no MCP protocol overhead.
      try {
        const client = restMod.createSupabaseRestClient({
          projectRef: inputs.supabaseProjectRef,
          accessToken,
          policy,
        });
        supabaseRestSources = {
          projectRef: inputs.supabaseProjectRef,
          database: restMod.createSupabaseRestDatabase(reg.id, client),
          storage: restMod.createSupabaseRestStorage(reg.id, client),
        };
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: new CliUsageError(`--supabase setup failed: ${m}`),
        };
      }
    } else if (reg.id === mcpMod.supabaseMcpId) {
      // Dev-gated MCP alternative backend. The MCP registration's
      // factories throw — the connector wiring needs a `SupabaseClient`
      // instance, not just policy + token. Build it here.
      const supabaseModule = await import('../connectors/supabase/index.js');
      try {
        supabaseMcpTransport =
          deps.supabaseTransportFactory !== undefined
            ? deps.supabaseTransportFactory({
                projectRef: inputs.supabaseProjectRef,
                accessToken,
              })
            : supabaseModule.createDefaultSupabaseTransport({
                projectRef: inputs.supabaseProjectRef,
                accessToken,
              });
        supabaseMcpClient = supabaseModule.createSupabaseClient({
          transport: supabaseMcpTransport,
          projectRef: inputs.supabaseProjectRef,
          policy,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: new CliUsageError(
            `--dev-supabase-backend ${String(reg.id)} setup failed: ${m}`,
          ),
        };
      }
    } else {
      return {
        ok: false,
        error: new CliUsageError(
          `--dev-supabase-backend "${backendStr}" is registered but has no Supabase capability wiring (label: ${reg.label})`,
        ),
      };
    }
  }

  registerPhase1Agents(orchestrator, {
    ...(inputs.supabaseSchemaPath !== undefined
      ? { supabaseSchemaSqlPath: inputs.supabaseSchemaPath }
      : {}),
    ...(supabaseMcpClient !== undefined && inputs.supabaseProjectRef !== undefined
      ? {
          supabaseMcpClient,
          supabaseMcpProjectRef: inputs.supabaseProjectRef,
        }
      : {}),
    ...(supabaseRestSources !== undefined
      ? {
          supabaseRestDatabase: supabaseRestSources.database,
          supabaseRestStorage: supabaseRestSources.storage,
          supabaseRestProjectRef: supabaseRestSources.projectRef,
        }
      : {}),
    rulesPath: bundledRulesDir(),
    ...(discoveredLockfile !== undefined
      ? { lockfilePath: discoveredLockfile }
      : {}),
    ...(deps.scannerRunnersOverride !== undefined
      ? { runners: deps.scannerRunnersOverride }
      : {}),
  });
  let exitCode = 0;
  try {
    const result = await orchestrator.run(context);
    // --fail-on-blocker wiring per step 18 Done-when: non-zero exit
    // when any control card reads `launch_blocker`. We approximate via
    // a finding-level check: any confirmed_issue + fix_before_launch,
    // or any likely_issue with high evidence_strength + fix_before_launch.
    if (inputs.failOnBlocker) {
      const hasBlocker = result.findings.some(
        (f) =>
          (f.finding_type === 'confirmed_issue' &&
            f.review_action === 'fix_before_launch') ||
          (f.finding_type === 'likely_issue' &&
            f.evidence_strength === 'high' &&
            f.review_action === 'fix_before_launch'),
      );
      if (hasBlocker) exitCode = 1;
    }
    // Reporter invocation per step 14 Done-when: produce
    // veyra-report.md (always) and veyra-report.json (if --json).
    // The evidence-report agent persists readiness-report.json as the
    // source of truth; we read it back and render user-facing
    // formats from there. Failure to read/render does not fail the
    // scan — the artifact is the durable source.
    const readinessJsonPath = path.join(
      inputs.projectRoot,
      '.veyra',
      'scans',
      scanId,
      'readiness-report.json',
    );
    try {
      const text = await fs.readFile(readinessJsonPath, 'utf8');
      const readinessReport = JSON.parse(text) as import('../types/readiness-report.js').ReadinessReport;
      const md = await import('../reporters/markdown/index.js');
      const jr = await import('../reporters/json/index.js');

      // Step 21 Bug 2: load declared-context.json + inventory-bootstrap.json
      // so the renderer's "Declared project context" + "Observed evidence"
      // sections cite real content. Reads are best-effort — a missing
      // or unparseable artifact falls back to the placeholder rendering.
      type DeclaredContextShape = {
        readonly observed_evidence?: import('../types/declared-context.js').ObservedEvidence;
        readonly declared_intent?: import('../types/declared-context.js').DeclaredIntent;
      };
      type InventoryBootstrapShape = {
        readonly observed_evidence?: import('../types/declared-context.js').ObservedEvidence;
      };

      // Step 21 retro f3: read both artifacts via `context.artifactDir`
      // (the same value the orchestrator hands every agent), not by
      // reconstructing the layout. A future change to artifactDir
      // (e.g. configurable scan output root) lands here without
      // silently regressing to placeholder rendering.
      const declaredContextPath = path.join(
        context.artifactDir,
        'declared-context.json',
      );
      const inventoryPath = path.join(
        context.artifactDir,
        'inventory-bootstrap.json',
      );
      let declaredContext: { declared_intent?: import('../types/declared-context.js').DeclaredIntent } | undefined;
      let observedEvidence: import('../types/declared-context.js').ObservedEvidence | undefined;
      try {
        const dcText = await fs.readFile(declaredContextPath, 'utf8');
        const parsed = JSON.parse(dcText) as DeclaredContextShape;
        if (parsed.declared_intent !== undefined) {
          declaredContext = { declared_intent: parsed.declared_intent };
        }
        // declared-context.json carries observed_evidence too (the
        // composer merges both halves); prefer this as the source for
        // the report's "Observed evidence" section.
        if (parsed.observed_evidence !== undefined) {
          observedEvidence = parsed.observed_evidence;
        }
      } catch {
        // Missing or unparseable declared-context.json — fall back
        // below to inventory-bootstrap.json alone.
      }
      if (observedEvidence === undefined) {
        try {
          const invText = await fs.readFile(inventoryPath, 'utf8');
          const parsed = JSON.parse(invText) as InventoryBootstrapShape;
          if (parsed.observed_evidence !== undefined) {
            observedEvidence = parsed.observed_evidence;
          }
        } catch {
          // No inventory either — renderer keeps its placeholder text.
        }
      }

      // Step 27: schema-source note. Customer-default is REST
      // (`supabase-rest`); the dev-gated MCP backend and the
      // SQL-file path still surface with their existing labels.
      const schemaSourceTag:
        | 'sql_file'
        | 'mcp'
        | 'mcp_overriding_sql_file'
        | 'rest'
        | undefined =
        supabaseRestSources !== undefined
          ? 'rest'
          : supabaseMcpClient !== undefined && inputs.supabaseSchemaPath !== undefined
            ? 'mcp_overriding_sql_file'
            : supabaseMcpClient !== undefined
              ? 'mcp'
              : inputs.supabaseSchemaPath !== undefined
                ? 'sql_file'
                : undefined;

      const reportOptions: import('../reporters/markdown/index.js').MarkdownReportOptions = {
        ...(declaredContext !== undefined ? { declaredContext } : {}),
        ...(observedEvidence !== undefined ? { observedEvidence } : {}),
        ...(schemaSourceTag !== undefined ? { schemaSource: schemaSourceTag } : {}),
      };
      await fs.writeFile(
        inputs.outPath,
        md.renderMarkdownReport(readinessReport, reportOptions),
        'utf8',
      );
      if (inputs.jsonPath !== undefined) {
        await fs.writeFile(inputs.jsonPath, jr.renderJsonReport(readinessReport), 'utf8');
      }
    } catch {
      // No readiness-report.json — evidence-report didn't run or
      // failed; the orchestrator already recorded that as a warning.
      // Reporter is a downstream concern.
    }
  } catch (e) {
    if (e instanceof NotImplementedError) {
      deps.logger.info(
        'orchestrator runs no agents yet; full wiring lands in phases/phase-1/steps/18-orchestrator-wiring-and-failure-isolation.md',
      );
    } else {
      throw e;
    }
  } finally {
    // Step 25 retro-f2: tear down the Supabase MCP transport at scan
    // end. The production SDK-backed transport holds a child-process
    // handle (the spawned `npx @supabase/mcp-server-supabase`); without
    // this close path, the subprocess can leak past the scan or keep
    // the parent process alive. Test transports may omit close() —
    // the field is optional so we null-check before invoking.
    if (supabaseMcpTransport?.close !== undefined) {
      try {
        await supabaseMcpTransport.close();
      } catch (closeErr) {
        const m = closeErr instanceof Error ? closeErr.message : String(closeErr);
        deps.logger.warn(`supabase-mcp transport close failed: ${m}`);
      }
    }
  }

  return ok({ exitCode });
}

export function buildScanCommand(deps: ScanCommandDeps): Command {
  const veyraDev = deps.envReader('VEYRA_DEV') === '1';
  const cmd = new Command('scan')
    .description(
      'Run launch-readiness checks against a local Lovable + Supabase project. Reports which controls were checked, which evidence was found, which was missing, and which issues appear launch-blocking. Phase 1 implements --mode read_only_evidence only. Supabase metadata is read via the Management REST API by default (--supabase <project_ref> + SUPABASE_ACCESS_TOKEN env var); the legacy --supabase-mcp flag is deprecated and rejects at parse-time. Lovable code is read from the local filesystem (the customer clones their Lovable GitHub repo first); the --lovable-mcp flag is deferred to step 28 and rejects at parse-time. AI is opt-in: the deterministic baseline runs without any AI flag or env var. Opt-in requires BOTH --ai-provider <name> AND the corresponding env var (ANTHROPIC_API_KEY for anthropic; OPENAI_API_KEY is Phase 2 only). --no-ai is the hard override for CI runs that must not call AI even when opted-in elsewhere.',
    )
    .requiredOption('--project <path>', 'path to the Lovable project root')
    .option(
      '--supabase <project_ref>',
      'enable Supabase Management REST API reads for the given project_ref (default backend). Requires SUPABASE_ACCESS_TOKEN in the environment.',
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
      'DEPRECATED: rejects at parse-time. Lovable OAuth client is deferred to step 28; for Phase 1, clone the project repo and pass --project <path>.',
      false,
    )
    .option(
      '--lovable-project <id>',
      'Lovable project id (paired with --lovable-mcp; both are deprecated as of step 27).',
    )
    .option(
      '--supabase-mcp <project_ref>',
      'DEPRECATED: rejects at parse-time. Use --supabase <project_ref> for REST default; MCP backend is gated behind VEYRA_DEV=1.',
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
  if (veyraDev) {
    // Step 27 Done-When #8: dev-only flags are hidden from the default
    // --help output. They appear only when VEYRA_DEV=1 is set in the
    // environment. Customers do not see them; contributors do.
    cmd
      .option(
        '--dev-supabase-backend <id>',
        'developer-only: select Supabase data-source backend by registry id (default: supabase-rest). Requires --supabase <project_ref> and VEYRA_DEV=1.',
      )
      .option(
        '--dev-supabase-schema <path>',
        'developer-only: parse a local pg_dump SQL file instead of any remote backend. Requires VEYRA_DEV=1.',
      );
  } else {
    // When VEYRA_DEV is unset, the dev flags are still accepted by
    // commander (so the rejection message can fire from validate),
    // but `.hideHelp()` keeps them out of `--help` output.
    cmd
      .option(
        '--dev-supabase-backend <id>',
        'developer-only: requires VEYRA_DEV=1',
      )
      .option(
        '--dev-supabase-schema <path>',
        'developer-only: requires VEYRA_DEV=1',
      );
    // Hide both from the rendered help when VEYRA_DEV is unset.
    for (const opt of cmd.options) {
      if (opt.long === '--dev-supabase-backend' || opt.long === '--dev-supabase-schema') {
        opt.hidden = true;
      }
    }
  }
  return cmd;
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
    ...maybeString('supabase', raw.supabase),
    ...maybeString('devSupabaseBackend', raw.devSupabaseBackend),
    ...maybeString('devSupabaseSchema', raw.devSupabaseSchema),
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
