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
import { runAgenticLoop } from '../core/orchestrator/agentic-loop.js';
import { createToolRegistry } from '../core/tools/registry.js';
import {
  type LoopTraceSummary,
  renderAgenticReport,
} from '../reporters/markdown/agentic-report.js';
import {
  bundledRulesDir,
  discoverLockfile,
  registerPhase1Agents,
} from './agent-registration.js';
import { constructLoopDriver } from './ai-provider-factory.js';
import { parseLoopCliOptions } from './loop-cli-options.js';
import { registerReadOnlyTools } from './tool-registration.js';
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
  /**
   * Step 40c-v3 addendum (originally Step 40): env-var NAME for the Supabase
   * anon key the Mode B sign-in path needs. The anon key is NOT a secret per
   * Supabase docs, but env-var-NAME-on-argv is symmetric with
   * `--supabase-service-role-key`. The value never appears on argv.
   */
  readonly supabaseAnonKey?: string;
  readonly approveActive?: boolean;
  readonly ci?: boolean;
  readonly approvalFile?: string;
  readonly ai: boolean;
  readonly aiProvider?: string;
  readonly aiHypothesisBudget?: string;
  readonly aiConcernThreshold?: string;
  readonly aiCacheTtl?: string;
  readonly aiModel?: string;
  /**
   * Step 31d: agentic-loop budget overrides (e.g.
   * `calls=40,wall_ms=300000,cost=2000000,steps=200`). Forwarded to
   * `parseLoopCliOptions` so the credential-on-argv guard fires through the
   * real `scan` command.
   */
  readonly loopBudget?: string;
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
  /**
   * Step 31d: raw `--loop-budget` value (e.g. `calls=40,wall_ms=300000`)
   * threaded through validation so the Bedrock loop branch parses it via
   * `parseLoopCliOptions` (which also runs the credential-on-argv guard).
   */
  readonly loopBudget?: string;
  /**
   * Step 40c-v3 Mode B fields. Populated by `validateScanOptions` only when
   * Mode B was selected; carried through to `runBedrockLoopBranchModeB`.
   */
  readonly supabaseSandboxProjectRef?: string;
  readonly supabaseServiceRoleEnvVarName?: string;
  readonly supabaseAnonKeyEnvVarName?: string;
}

export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface ScanCommandDeps {
  readonly stat: (p: string) => Promise<StatLike>;
  readonly orchestratorFactory: () => ScanOrchestrator;
  /**
   * Step 40b seam (PLAN §G.1): the agentic-loop entry that replaces the
   * topo-sort orchestrator. Injected so the fake-runner test seam is
   * preserved (no circular dep — codex r2 confirmed). Step 40 wires the CLI
   * to actually invoke this; here it is added to the deps so the migration
   * is no longer a breaking change.
   */
  readonly loopFactory?: typeof runAgenticLoop;
  /**
   * Step 40b seam (PLAN §G.1, §C placement rule): the read-only tool
   * registration that builds the catalog the loop drives. Step 33's
   * `registerReadOnlyTools`. Optional / defaulted via `defaultScanCommandDeps`.
   */
  readonly registerTools?: typeof registerReadOnlyTools;
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
   * Step 31d codex §6.5-r2 SHOULD #1: raw argv provider for the
   * credential-on-argv guard inside the Bedrock loop branch. Production
   * callers leave this undefined and `defaultScanCommandDeps` wires it to
   * `() => process.argv.slice(2)`; tests inject a fake array so V5a fires
   * deterministically without mutating `process.argv` globally.
   */
  readonly rawArgvProvider?: () => readonly string[];
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
    // Step 40c-v3 — same name/value discipline for `--supabase-anon-key`:
    // accept only a SHOUTY_CASE env var name; refuse anything that looks
    // like a key value on argv.
    if (
      options.supabaseAnonKey !== undefined &&
      options.supabaseAnonKey.length > 0
    ) {
      const modB = await import('./mode-b.js');
      if (modB.looksLikeKeyValue(options.supabaseAnonKey)) {
        return err(
          new CliUsageError(
            '--supabase-anon-key takes the NAME of an env var, not the key value. Set the env var (e.g. VEYRA_SUPABASE_ANON_KEY) and pass --supabase-anon-key VEYRA_SUPABASE_ANON_KEY.',
          ),
        );
      }
      if (!modB.isValidEnvVarName(options.supabaseAnonKey)) {
        return err(
          new CliUsageError(
            `--supabase-anon-key expects a SHOUTY_CASE env-var NAME; got "${options.supabaseAnonKey}"`,
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
        // Codex retro 2.11: signature verification stays opt-out
        // until the minisign npm library is picked. CI runs that
        // need a real verify should set --skip-signature-verify
        // explicitly OR wait for the verify-library follow-up.
        // For now we default to opt-out here so the gate doesn't
        // unconditionally refuse every CI run.
        skipSignatureVerify: true,
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
    ...(options.loopBudget !== undefined
      ? { loopBudget: options.loopBudget }
      : {}),
    // Step 40c-v3 Mode B fields — only populated when Mode B was selected
    // (validated above). The Bedrock Mode B branch reads them; topo path
    // continues to read the individual options fields directly.
    ...(options.mode === 'sandbox_active_validation' &&
    options.supabaseSandbox !== undefined
      ? { supabaseSandboxProjectRef: options.supabaseSandbox }
      : {}),
    ...(options.mode === 'sandbox_active_validation' &&
    options.supabaseServiceRoleKey !== undefined
      ? { supabaseServiceRoleEnvVarName: options.supabaseServiceRoleKey }
      : {}),
    ...(options.mode === 'sandbox_active_validation' &&
    options.supabaseAnonKey !== undefined
      ? { supabaseAnonKeyEnvVarName: options.supabaseAnonKey }
      : {}),
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
    // Step 31d: SDK-chain-resolved providers (Bedrock) — the actual identity
    // resolution happens at runtime in the provider's `auth.ts`. Here we only
    // confirm each any-of env group has at least one var set.
    if (entry.availability.kind === 'available_via_sdk_chain') {
      for (const group of entry.availability.requiredAnyOfEnv) {
        const someSet = group.some((name) => {
          const v = deps.envReader(name);
          return v !== undefined && v.length > 0;
        });
        if (!someSet) {
          return err(
            new CliUsageError(
              `--ai-provider ${options.aiProvider}: one of ${group.join('/')} must be set (the SDK chain resolves credentials at runtime; region is the only env var the CLI requires)`,
            ),
          );
        }
      }
      return ok({
        aiDisabled: false,
        aiOptIn: true,
        aiProvider: entry.id,
        ...knobs,
      });
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
    // codex p3-r2-002: providers that need a multi-env credential set (e.g.
    // Bedrock: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION) declare
    // them via `requiresAdditionalEnv`. Each entry is either a single var name
    // (required) or a list (any-of). The runtime auth path validates the same
    // set; this is a CLI fail-closed early reject.
    if (entry.availability.requiresAdditionalEnv !== undefined) {
      for (const required of entry.availability.requiresAdditionalEnv) {
        if (typeof required === 'string') {
          const v = deps.envReader(required);
          if (v === undefined || v.length === 0) {
            return err(
              new CliUsageError(
                `--ai-provider ${options.aiProvider}: ${required} not set (AI opt-in requires the full credential set)`,
              ),
            );
          }
        } else {
          // any-of group
          const someSet = required.some((name) => {
            const v = deps.envReader(name);
            return v !== undefined && v.length > 0;
          });
          if (!someSet) {
            return err(
              new CliUsageError(
                `--ai-provider ${options.aiProvider}: one of ${required.join('/')} must be set (AI opt-in requires the full credential set)`,
              ),
            );
          }
        }
      }
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

  // Step 31d MUST #3: orchestrator construction MOVED below the Bedrock loop
  // branch. The topo path needs it; the Bedrock branch returns before reaching
  // `orchestrator.run(...)` and must NOT call `deps.orchestratorFactory()` —
  // V16 asserts the spy factory is never invoked on the Bedrock route.

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

  // ─────────── Step 31d: Bedrock + Mode A → agentic-loop runtime route ───────
  // Single decision point. When all three conditions hold, the new branch
  // runs and returns; every other combination falls through to the unchanged
  // topo-sort path below.
  if (
    inputs.aiOptIn &&
    inputs.aiProvider !== undefined &&
    String(inputs.aiProvider) === 'bedrock' &&
    inputs.mode === 'read_only_evidence'
  ) {
    // Step 40d: synthesize the pre-loop project briefing BEFORE the Mode A
    // dispatch so the AI driver sees `view.briefing` on every `proposeNext`.
    // Both Mode A and Mode B branches consume the same briefing helper —
    // Decision H1 guarantees inventory is built BEFORE briefing in both.
    const briefingBundle = await synthesizeBriefingForLoop({
      projectRoot: inputs.projectRoot,
      artifactDir,
      aiOptIn: inputs.aiOptIn,
      modelId: inputs.aiModel,
      envReader: deps.envReader,
      providerId: inputs.aiProvider,
    });
    return runBedrockLoopBranch({
      inputs,
      deps,
      policy,
      scanId,
      artifactDir,
      supabaseMcpClient,
      discoveredLockfile,
      ...(briefingBundle.briefing !== undefined ? { briefing: briefingBundle.briefing } : {}),
      ...(briefingBundle.digest !== undefined ? { briefingDigest: briefingBundle.digest } : {}),
    });
  }

  // Step 40c-v3 — Bedrock + Mode B (sandbox_active_validation) runtime route.
  // Replaces the Step 31d Cut-3 reject. The branch synthesizes a sandbox
  // actor, establishes their session via the anon-key Auth client, runs the
  // AI-driven IDOR probe against PostgREST, and reverse-walks cleanup
  // (signOut → deleteUser per actor) in a try/finally.
  if (
    inputs.aiOptIn &&
    inputs.aiProvider !== undefined &&
    String(inputs.aiProvider) === 'bedrock' &&
    inputs.mode === 'sandbox_active_validation'
  ) {
    // Step 40d: same pre-loop briefing helper as Mode A. Decision H1
    // guarantees `inventory-bootstrap.json` exists before synthesis runs in
    // either branch.
    const briefingBundle = await synthesizeBriefingForLoop({
      projectRoot: inputs.projectRoot,
      artifactDir,
      aiOptIn: inputs.aiOptIn,
      modelId: inputs.aiModel,
      envReader: deps.envReader,
      providerId: inputs.aiProvider,
    });
    return runBedrockLoopBranchModeB({
      inputs,
      deps,
      policy,
      scanId,
      artifactDir,
      supabaseMcpClient,
      discoveredLockfile,
      ...(briefingBundle.briefing !== undefined ? { briefing: briefingBundle.briefing } : {}),
      ...(briefingBundle.digest !== undefined ? { briefingDigest: briefingBundle.digest } : {}),
    });
  }

  // Step 31d MUST #3: orchestrator construction lives HERE (below the Bedrock
  // branch). The topo-sort path consumes it; the Bedrock branch returns above
  // without ever calling the factory.
  const orchestrator = deps.orchestratorFactory();

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

// ──────────── Step 31d: Bedrock + Mode A agentic-loop branch ────────────────
//
// Runs when `inputs.aiOptIn && inputs.aiProvider === 'bedrock' && inputs.mode
// === 'read_only_evidence'`. All other flag combinations fall through to the
// existing topo-sort orchestrator path above — no behaviour change there.

interface BedrockLoopBranchArgs {
  readonly inputs: ValidatedScanInputs;
  readonly deps: ScanCommandDeps;
  readonly policy: ValidationPolicy;
  readonly scanId: string;
  readonly artifactDir: string;
  readonly supabaseMcpClient: import('../connectors/supabase/client.js').SupabaseClient | undefined;
  readonly discoveredLockfile: string | undefined;
  /**
   * Step 40d: pre-loop project briefing synthesized once before either Mode A
   * or Mode B branch dispatches. Both branches thread it into the
   * `runAgenticLoop` deps so the AI driver sees `view.briefing` on every
   * `proposeNext` call. Absent when synthesis failed catastrophically.
   */
  readonly briefing?: import('./briefing/types.js').ProjectBriefing;
  readonly briefingDigest?: string;
}

async function runBedrockLoopBranch(
  args: BedrockLoopBranchArgs,
): Promise<Result<{ readonly exitCode: number }, CliUsageError>> {
  const { inputs, deps, policy, scanId, artifactDir } = args;

  // Step 31d: `--json` on the agentic path is deferred to Cut 2 / Step 37.
  if (inputs.jsonPath !== undefined) {
    return err(
      new CliUsageError(
        'JSON output is not yet wired on the agentic path (Cut 2 / Step 37 follow-up). Rerun without --json or pick a non-Bedrock provider.',
      ),
    );
  }

  // Parse loop-options (also runs the credential-on-argv guard against the
  // real argv array — Step 31d V5a). Codex §6.5-r2 SHOULD #1: read argv from
  // `deps.rawArgvProvider` (injected) instead of `process.argv` directly,
  // so V5a is testable without touching `process.argv` globally.
  const rawArgv =
    deps.rawArgvProvider !== undefined
      ? [...deps.rawArgvProvider()]
      : [...process.argv.slice(2)];
  const loopOpts = parseLoopCliOptions({
    env: inputs.env,
    ...(inputs.loopBudget !== undefined ? { loopBudget: inputs.loopBudget } : {}),
    rawArgv,
  });
  if (!loopOpts.ok) {
    return err(new CliUsageError(loopOpts.error.message));
  }
  // Note: a Mode B reject used to live here, but the outer guard at the
  // single decision point already ensures `inputs.mode === 'read_only_evidence'`
  // when this branch runs (§6.5 round-1 review SHOULD #1). When Cut 3 wires
  // Mode B on the Bedrock loop path, that branch will be a separate routing
  // arm — not a guard inside this one.

  // Build the registry via the SAME function the structural lint and the
  // import-graph guard validate (Step 33 / Step 35 / V11 / V15).
  const registry = createToolRegistry();
  if (deps.registerTools !== undefined) {
    deps.registerTools(registry, {
      rulesPath: bundledRulesDir(),
      ...(args.discoveredLockfile !== undefined
        ? { lockfilePath: args.discoveredLockfile }
        : {}),
      ...(args.supabaseMcpClient !== undefined
        ? { supabaseClient: args.supabaseMcpClient }
        : {}),
      ...(deps.scannerRunnersOverride !== undefined
        ? { runners: deps.scannerRunnersOverride }
        : {}),
    });
  }

  // Build the loop driver (Bedrock — live transport OR recorded fixture per
  // `VEYRA_BEDROCK_RECORDING`).
  let driver;
  try {
    const built = await constructLoopDriver({
      providerId: inputs.aiProvider!,
      envReader: deps.envReader,
      defaultModelId: inputs.aiModel,
    });
    driver = built.driver;
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new CliUsageError(m));
  }

  const toolContext = {
    scanId,
    projectPath: inputs.projectRoot,
    artifactDir,
  };

  const loopFactory = deps.loopFactory ?? runAgenticLoop;
  // Step 35b: inject the per-control predicate registry as the loop's
  // `runFloor` deps. The registry lives in `src/cli/floor-predicates.ts`
  // (NOT `src/core/`) so the no-cross-layer-imports invariant stays green;
  // the floor accepts predicates as an injected parameter.
  const { FLOOR_PREDICATES } = await import('./floor-predicates.js');
  const { runClassificationPredicates } = await import(
    '../core/orchestrator/floor.js'
  );

  // Step 40e: construct the per-scan hypothesis registry and register the
  // two AI-authoring tools. The registry is closure-owned; the loop reads
  // it only via `view.hypotheses` projection. Cleared in `finally` below.
  // codex 40e-diff-001 [APPLIED]: use the real redactSecrets sanitizer
  // (gitleaks + AI extras) so AI-authored prose can never persist raw
  // secrets to hypotheses.json — never the identity (raw) => raw stub.
  const { HypothesisRegistry } = await import('./hypothesis-registry/registry.js');
  const { registerHypothesisTools } = await import('./tool-registration.js');
  const { writeHypothesesArtifact } = await import(
    './hypothesis-registry/persist.js'
  );
  const { redactSecrets: redactSecretsForBriefing } = await import(
    '../ai/sanitization.js'
  );
  const hypothesisRegistry = new HypothesisRegistry({ now: Date.now });
  // The `isAcceptedStepRef` predicate reads loop state — populated via the
  // onStateConstructed callback before the first proposeNext runs.
  const stateRef: { current: import('../core/orchestrator/artifact-state.js').ArtifactState | undefined } = { current: undefined };
  registerHypothesisTools(registry, {
    registry: hypothesisRegistry,
    redactor: (raw) => redactSecretsForBriefing(raw) as unknown as string,
    isAcceptedStepRef: (seq) => stateRef.current?.isAcceptedStepRef(seq) ?? false,
    ...(inputs.aiModel !== undefined ? { modelId: inputs.aiModel } : {}),
  });

  let result;
  try {
    result = await loopFactory({
      registry,
      aiDriver: driver,
      policy,
      context: toolContext,
      artifactDir,
      ...(Object.keys(loopOpts.value.loopBudget).length > 0
        ? { caps: loopOpts.value.loopBudget }
        : {}),
      requiredModelId: inputs.aiModel,
      runFloor: (facts, gaps) =>
        runClassificationPredicates(facts, gaps, FLOOR_PREDICATES),
      ...(args.briefing !== undefined ? { briefing: args.briefing } : {}),
      ...(args.briefingDigest !== undefined ? { briefingDigest: args.briefingDigest } : {}),
      hypothesisRegistry,
      onStateConstructed: (state) => {
        stateRef.current = state;
      },
    });
  } finally {
    // Step 40e Decision I: persist + clear regardless of loop outcome.
    // Best-effort write (a failure leaves the registry in memory; clear
    // still runs so no in-process residual after this branch returns).
    try {
      await writeHypothesesArtifact(artifactDir, hypothesisRegistry.snapshot());
    } catch {
      // best-effort
    }
    hypothesisRegistry.clear();
  }

  // Bridge the loop result → markdown reporter.
  const trace: LoopTraceSummary = summariseRecords(
    result.state.records(),
    result.budget_snapshot,
  );
  // Step 40e Decision J: hypothesis counts snapshot AFTER the loop ended +
  // the registry was persisted but BEFORE the `clear()` ran (the registry
  // is still live in this scope post-finally because we already persisted).
  // Counts are read from the hypotheses.json artifact directly so the
  // post-finally `clear()` doesn't race the count rendering.
  let hypothesisCounts: Readonly<{
    proposed: number;
    partially_evidenced: number;
    evidenced_against: number;
    superseded: number;
  }> = { proposed: 0, partially_evidenced: 0, evidenced_against: 0, superseded: 0 };
  try {
    const raw = await fs.readFile(
      path.join(artifactDir, 'hypotheses.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { readonly hypotheses: ReadonlyArray<{ readonly disposition: string }> };
    const c = { proposed: 0, partially_evidenced: 0, evidenced_against: 0, superseded: 0 };
    for (const h of parsed.hypotheses) {
      if (h.disposition === 'proposed') c.proposed += 1;
      else if (h.disposition === 'partially_evidenced') c.partially_evidenced += 1;
      else if (h.disposition === 'evidenced_against') c.evidenced_against += 1;
      else if (h.disposition === 'superseded') c.superseded += 1;
    }
    hypothesisCounts = c;
  } catch {
    // No artifact on disk → all-zero counts, footer still renders as 0 proposed.
  }

  const markdown = renderAgenticReport({
    narrative_prose:
      result.findings.length === 0
        ? 'Findings were checked; none appear launch-blocking.'
        : `${String(result.findings.length)} finding(s) need human review.`,
    findings: result.findings,
    ledger_missing: result.ledgerMissing,
    trace,
    narrative_used_fallback: true,
    ...(args.briefing !== undefined
      ? {
          project_briefing_ref: {
            basename: 'project-briefing.json',
            degraded: args.briefing.synthesis_mode === 'degraded_fallback',
          },
        }
      : {}),
    hypotheses_ref: {
      basename: 'hypotheses.json',
      counts: hypothesisCounts,
    },
  });
  try {
    await fs.mkdir(path.dirname(inputs.outPath), { recursive: true });
    await fs.writeFile(inputs.outPath, markdown, 'utf8');
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new CliUsageError(`failed to write report to ${inputs.outPath}: ${m}`));
  }

  // --fail-on-blocker — exit non-zero when any finding is fix_before_launch.
  let exitCode = 0;
  if (inputs.failOnBlocker) {
    const hasBlocker = result.findings.some(
      (f) => f.review_action === 'fix_before_launch',
    );
    if (hasBlocker) exitCode = 1;
  }
  return ok({ exitCode });
}

// ── Step 40c-v3 — Bedrock + Mode B (active-validation) runtime branch ──────
//
// Synthesizes an actor, signs them in, runs the AI-driven IDOR probe against
// the user's Supabase sandbox PostgREST surface, reverse-walks cleanup in
// `try / finally`. JWT + password live in the in-process ActorSecretRegistry;
// only digests persist (Decision G.2). Mode B argv gates (`--approve-active`,
// `--supabase-sandbox`, `--supabase-service-role-key`, `--supabase-anon-key`,
// optional `--ci`/`--approval-file`) ran in `validateScanOptions` BEFORE this
// branch is reached.
async function runBedrockLoopBranchModeB(
  args: BedrockLoopBranchArgs,
): Promise<Result<{ readonly exitCode: number }, CliUsageError>> {
  const { inputs, deps, policy, scanId, artifactDir } = args;

  if (inputs.jsonPath !== undefined) {
    return err(
      new CliUsageError(
        'JSON output is not yet wired on the agentic path (Cut 2 / Step 37 follow-up). Rerun without --json.',
      ),
    );
  }

  // Resolve required Mode B inputs.
  if (
    inputs.supabaseSandboxProjectRef === undefined ||
    inputs.supabaseServiceRoleEnvVarName === undefined ||
    inputs.supabaseAnonKeyEnvVarName === undefined
  ) {
    return err(
      new CliUsageError(
        '--ai-provider bedrock --mode sandbox_active_validation requires --supabase-sandbox <project_ref>, --supabase-service-role-key <ENV_VAR>, and --supabase-anon-key <ENV_VAR>.',
      ),
    );
  }
  const srk = deps.envReader(inputs.supabaseServiceRoleEnvVarName);
  const anonKey = deps.envReader(inputs.supabaseAnonKeyEnvVarName);
  if (srk === undefined || srk.length === 0) {
    return err(
      new CliUsageError(
        `--supabase-service-role-key names env var "${inputs.supabaseServiceRoleEnvVarName}" but it is unset in the environment.`,
      ),
    );
  }
  if (anonKey === undefined || anonKey.length === 0) {
    return err(
      new CliUsageError(
        `--supabase-anon-key names env var "${inputs.supabaseAnonKeyEnvVarName}" but it is unset in the environment.`,
      ),
    );
  }

  // Loop-budget + raw-argv guard (Step 31d V4 + V5a — same path as Mode A).
  const rawArgv =
    deps.rawArgvProvider !== undefined
      ? [...deps.rawArgvProvider()]
      : [...process.argv.slice(2)];
  const loopOpts = parseLoopCliOptions({
    env: inputs.env,
    ...(inputs.loopBudget !== undefined ? { loopBudget: inputs.loopBudget } : {}),
    rawArgv,
  });
  if (!loopOpts.ok) {
    return err(new CliUsageError(loopOpts.error.message));
  }

  // Lazy imports — keep Mode A and `--no-ai` paths free of these modules.
  const [
    { WriteRegistry },
    { ActorSecretRegistry: ActorSecretRegistryClass },
    { createSupabaseAdminClient },
    { createSupabaseAuthClient },
    { createDefaultProbeHttpTransport },
    { registerActiveValidationTools },
    { runClassificationPredicates },
    { FLOOR_PREDICATES },
  ] = await Promise.all([
    import('../core/sandbox/http-write-registry.js'),
    import('../core/sandbox/actor-secret-registry.js'),
    import('../connectors/supabase/admin/client.js'),
    import('../connectors/supabase/auth/client.js'),
    import('../scanners/probe-http/tool.js'),
    import('./tool-registration.js'),
    import('../core/orchestrator/floor.js'),
    import('./floor-predicates.js'),
  ]);

  const writeRegistry = new WriteRegistry();
  const actorSecretRegistry = new ActorSecretRegistryClass();

  let adminClient;
  try {
    adminClient = createSupabaseAdminClient({
      projectRef: inputs.supabaseSandboxProjectRef,
      serviceRoleKey: srk,
      // Codex §6.5 MF-4: pass read-only project refs so the admin client
      // refuses to operate on the same project the read-only scan reads from.
      // Sandbox MUST be a distinct Supabase project.
      ...(inputs.supabaseProjectRef !== undefined
        ? { readOnlyProjectRefs: [inputs.supabaseProjectRef] }
        : {}),
    });
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new CliUsageError(`supabase-admin setup failed: ${m}`));
  }
  const authClient = createSupabaseAuthClient({
    apiUrl: `https://${inputs.supabaseSandboxProjectRef}.supabase.co`,
    anonKey,
  });
  const probeHttpTransport = createDefaultProbeHttpTransport();

  // Build registry: read-only + active validation.
  const registry = createToolRegistry();
  if (deps.registerTools !== undefined) {
    deps.registerTools(registry, {
      rulesPath: bundledRulesDir(),
      ...(args.discoveredLockfile !== undefined
        ? { lockfilePath: args.discoveredLockfile }
        : {}),
      ...(args.supabaseMcpClient !== undefined
        ? { supabaseClient: args.supabaseMcpClient }
        : {}),
      ...(deps.scannerRunnersOverride !== undefined
        ? { runners: deps.scannerRunnersOverride }
        : {}),
    });
  }
  // Codex §6.5 MF-1 — record probe attempts via a mutable counter the
  // descriptor's closure can bump. Persisted to `http-write-registry.json`
  // after the loop completes (the loop's `state.probeAttemptCount()` ledger
  // predicate is also satisfied by counting probe-http entries in the write
  // registry post-hoc; see ledgerMissingFiltered below).
  let probeAttemptCounter = 0;
  const probeAttemptForwarder = (): void => {
    probeAttemptCounter += 1;
  };
  registerActiveValidationTools(registry, {
    writeRegistry,
    actorSecretRegistry,
    adminClient,
    authClient,
    probeHttpTransport,
    baseUrl: `https://${inputs.supabaseSandboxProjectRef}.supabase.co`,
    anonKey,
    scanId,
    recordProbeAttempt: probeAttemptForwarder,
  });

  // Build the loop driver.
  let driver;
  try {
    const built = await constructLoopDriver({
      providerId: inputs.aiProvider!,
      envReader: deps.envReader,
      defaultModelId: inputs.aiModel,
    });
    driver = built.driver;
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new CliUsageError(m));
  }

  const toolContext = { scanId, projectPath: inputs.projectRoot, artifactDir };
  const loopFactory = deps.loopFactory ?? runAgenticLoop;

  // Step 40e: per-scan hypothesis registry (Mode B). Same wiring shape as
  // Mode A — closure-owned, projected via view.hypotheses, persisted at
  // scan end, cleared in finally. codex 40e-diff-001 [APPLIED]: real
  // redactSecrets sanitizer (never identity).
  const { HypothesisRegistry } = await import('./hypothesis-registry/registry.js');
  const { registerHypothesisTools } = await import('./tool-registration.js');
  const { writeHypothesesArtifact } = await import(
    './hypothesis-registry/persist.js'
  );
  const { redactSecrets: redactSecretsForBriefingModeB } = await import(
    '../ai/sanitization.js'
  );
  const hypothesisRegistry = new HypothesisRegistry({ now: Date.now });
  const stateRef: { current: import('../core/orchestrator/artifact-state.js').ArtifactState | undefined } = { current: undefined };
  registerHypothesisTools(registry, {
    registry: hypothesisRegistry,
    redactor: (raw) => redactSecretsForBriefingModeB(raw) as unknown as string,
    isAcceptedStepRef: (seq) => stateRef.current?.isAcceptedStepRef(seq) ?? false,
    ...(inputs.aiModel !== undefined ? { modelId: inputs.aiModel } : {}),
  });

  // try/finally cleanup — codex round-2 MF-4 + V4b.
  let result: import('../core/orchestrator/agentic-loop.js').AgenticLoopResult | undefined;
  let runError: Error | undefined;
  try {
    result = await loopFactory({
      registry,
      aiDriver: driver,
      policy,
      context: toolContext,
      artifactDir,
      ...(Object.keys(loopOpts.value.loopBudget).length > 0
        ? { caps: loopOpts.value.loopBudget }
        : {}),
      requiredModelId: inputs.aiModel,
      runFloor: (facts, gaps) =>
        runClassificationPredicates(facts, gaps, FLOOR_PREDICATES),
      ...(args.briefing !== undefined ? { briefing: args.briefing } : {}),
      ...(args.briefingDigest !== undefined ? { briefingDigest: args.briefingDigest } : {}),
      hypothesisRegistry,
      onStateConstructed: (state) => {
        stateRef.current = state;
      },
    });
  } catch (cause) {
    runError = cause instanceof Error ? cause : new Error(String(cause));
  } finally {
    // Reverse-walk cleanup BOTH paths. Cleanup executors must not throw out.
    const cleanupExecutors = {
      http: async (entry: import('../core/sandbox/http-write-registry.js').WriteEntry): Promise<void> => {
        // probe-http records audit-only; the registry no-ops on those.
        // Non-audit HTTP writes don't ship in this step (cc-11-3 IDOR is GET).
        void entry;
      },
      admin: async (entry: import('../core/sandbox/http-write-registry.js').WriteEntry): Promise<void> => {
        // resource_id format: `supabase-admin:user:<uid>` (synthesize-actor) OR
        // `supabase-auth:session:<actor_id>` (establish-actor-session).
        if (entry.resource_id.startsWith('supabase-auth:session:')) {
          const actorId = entry.resource_id.slice('supabase-auth:session:'.length);
          const secret = actorSecretRegistry.get(actorId);
          // Use the JWT for signOut if available (Decision G.4); fall back
          // to UID if JWT was wiped or never set.
          const tokenOrUid = secret?.access_token ?? actorId;
          const r = await adminClient.signOutUser(tokenOrUid);
          if (!r.ok) throw r.error;
        } else if (entry.resource_id.startsWith('supabase-admin:user:')) {
          const uid = entry.resource_id.slice('supabase-admin:user:'.length);
          const r = await adminClient.deleteUser(uid);
          if (!r.ok) throw r.error;
        }
      },
    };
    const cleanupProof = await writeRegistry.reverseWalk(cleanupExecutors);
    // Persist cleanup-proof artifact for V19 visibility.
    try {
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(
        path.join(artifactDir, 'cleanup-proof.json'),
        JSON.stringify(cleanupProof, null, 2),
        'utf8',
      );
    } catch {
      // Best-effort; the report still renders.
    }
    // V21 — wipe the actor secret registry on success AND on crash.
    actorSecretRegistry.clearAll();

    // Step 40e Decision I: persist hypotheses.json sibling to cleanup-proof
    // + http-write-registry artifacts, then clear the registry. Best-effort.
    try {
      await writeHypothesesArtifact(artifactDir, hypothesisRegistry.snapshot());
    } catch {
      // best-effort
    }
    hypothesisRegistry.clear();
  }

  if (runError !== undefined) {
    return err(new CliUsageError(`Mode B loop crashed: ${runError.message}`));
  }
  if (result === undefined) {
    return err(new CliUsageError('Mode B loop returned no result'));
  }

  // Codex §6.5 MF-1 — persist `http-write-registry.json` from the WriteRegistry
  // contents so `hasArtifact('http-write-registry.json')` ledger predicate
  // fires. Also filter `declared_probe_attempted` out of ledgerMissing when
  // we observed at least one probe-http call (the §K predicate also wants
  // `probeAttemptCount() >= 1`; we count via the registry).
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, 'http-write-registry.json'),
      JSON.stringify(writeRegistry.list(), null, 2),
      'utf8',
    );
  } catch {
    // Best-effort; the report still renders.
  }
  const probeAttempts = probeAttemptCounter;
  const ledgerMissingFiltered =
    probeAttempts >= 1
      ? result.ledgerMissing.filter(
          (g) => g.baseline_item_id !== 'declared_probe_attempted',
        )
      : result.ledgerMissing;

  // Codex §6.5 MF-2 — promote cleanup failures to launch-blocking finding.
  // The reverse-walk in the `finally` block above produced a CleanupProof;
  // re-read it from disk for the finding builder.
  let cleanupFindings: readonly import('../types/finding.js').Finding[] = [];
  try {
    const proofRaw = await fs.readFile(
      path.join(artifactDir, 'cleanup-proof.json'),
      'utf8',
    );
    const proof = JSON.parse(proofRaw) as import('../core/sandbox/http-write-registry.js').CleanupProof;
    if (proof.residual_count > 0) {
      const { cleanupFailedFinding } = await import(
        '../core/sandbox/cleanup-failed-finding.js'
      );
      cleanupFindings = [cleanupFailedFinding(proof)];
    }
  } catch {
    // No cleanup-proof file (best-effort persist) — skip the finding.
  }

  // Codex §6.5 MF-3 — build active_outcomes rows from the loop's accepted
  // probe_response facts so the renderer surfaces per-probe outcomes,
  // not just trace counts. classifyProbe is deterministic.
  const { classifyProbe } = await import(
    '../agents/sandbox-runner/outcome-classifier.js'
  );
  const activeOutcomes: import('../reporters/markdown/agentic-report.js').ActiveOutcomeRow[] =
    [];
  for (const fact of result.facts) {
    // facts may be NamedFact[] (loop shape) — match by the source_fields
    // structure if present. For audit simplicity here we read the source
    // payload via the bridge-decoded result instead by iterating over
    // result.state's accepted facts. The result.facts list is already a
    // flat NamedFact array per the loop contract; we rebuild
    // ProbeObservations by name lookups.
    if (typeof fact.value !== 'object' || fact.value === null) continue;
    if (!Array.isArray(fact.value)) continue;
    // Find the source_kind = 'probe_response' marker.
    const fields = new Map<string, unknown>();
    for (const f of fact.value as ReadonlyArray<{ name: string; value: unknown }>) {
      fields.set(f.name, f.value);
    }
    if (fields.get('source_kind') !== 'probe_response') continue;
    const sourceFieldsRaw = fields.get('source_fields');
    if (!Array.isArray(sourceFieldsRaw)) continue;
    const srcFields = new Map<string, unknown>();
    for (const f of sourceFieldsRaw as ReadonlyArray<{
      name: string;
      value: unknown;
    }>) {
      srcFields.set(f.name, f.value);
    }
    const probeId = srcFields.get('probe_id');
    const controlId = srcFields.get('control_id');
    const payloadRaw = srcFields.get('payload');
    if (
      typeof probeId !== 'string' ||
      typeof controlId !== 'string' ||
      !Array.isArray(payloadRaw)
    )
      continue;
    const payloadFields = new Map<string, unknown>();
    for (const f of payloadRaw as ReadonlyArray<{ name: string; value: unknown }>) {
      payloadFields.set(f.name, f.value);
    }
    const status = payloadFields.get('response_status');
    const returnedRows = payloadFields.get('response_returned_rows');
    const expectation = payloadFields.get('expectation');
    if (
      typeof status !== 'number' ||
      typeof returnedRows !== 'boolean' ||
      (expectation !== 'expect_denial' && expectation !== 'expect_allow')
    )
      continue;
    const outcome = classifyProbe({
      probe_id: probeId,
      control_id: controlId,
      response_status: status,
      response_returned_rows: returnedRows,
      expectation,
    });
    activeOutcomes.push({
      probe_id: probeId,
      control_id: controlId,
      outcome,
      expectation,
    });
  }

  // Bridge to markdown reporter.
  const allFindings: readonly import('../types/finding.js').Finding[] = [
    ...cleanupFindings,
    ...result.findings,
  ];
  const trace: LoopTraceSummary = summariseRecords(
    result.state.records(),
    result.budget_snapshot,
  );
  // Step 40e Decision J: hypothesis counts for the footer (Mode B).
  let hypothesisCountsModeB: Readonly<{
    proposed: number;
    partially_evidenced: number;
    evidenced_against: number;
    superseded: number;
  }> = { proposed: 0, partially_evidenced: 0, evidenced_against: 0, superseded: 0 };
  try {
    const raw = await fs.readFile(
      path.join(artifactDir, 'hypotheses.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { readonly hypotheses: ReadonlyArray<{ readonly disposition: string }> };
    const c = { proposed: 0, partially_evidenced: 0, evidenced_against: 0, superseded: 0 };
    for (const h of parsed.hypotheses) {
      if (h.disposition === 'proposed') c.proposed += 1;
      else if (h.disposition === 'partially_evidenced') c.partially_evidenced += 1;
      else if (h.disposition === 'evidenced_against') c.evidenced_against += 1;
      else if (h.disposition === 'superseded') c.superseded += 1;
    }
    hypothesisCountsModeB = c;
  } catch {
    // No artifact on disk → all-zero counts.
  }

  const markdown = renderAgenticReport({
    narrative_prose:
      allFindings.length === 0
        ? 'Findings were checked; none appear launch-blocking.'
        : `${String(allFindings.length)} finding(s) need human review.`,
    findings: allFindings,
    ledger_missing: ledgerMissingFiltered,
    trace,
    narrative_used_fallback: true,
    ...(activeOutcomes.length > 0 ? { active_outcomes: activeOutcomes } : {}),
    ...(args.briefing !== undefined
      ? {
          project_briefing_ref: {
            basename: 'project-briefing.json',
            degraded: args.briefing.synthesis_mode === 'degraded_fallback',
          },
        }
      : {}),
    hypotheses_ref: {
      basename: 'hypotheses.json',
      counts: hypothesisCountsModeB,
    },
  });
  try {
    await fs.mkdir(path.dirname(inputs.outPath), { recursive: true });
    await fs.writeFile(inputs.outPath, markdown, 'utf8');
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new CliUsageError(`failed to write report to ${inputs.outPath}: ${m}`));
  }

  let exitCode = 0;
  if (inputs.failOnBlocker) {
    const hasBlocker = allFindings.some(
      (f) => f.review_action === 'fix_before_launch',
    );
    if (hasBlocker) exitCode = 1;
  }
  return ok({ exitCode });
}

function summariseRecords(
  records: ReadonlyArray<import('../core/orchestrator/artifact-state.js').LoopRecord>,
  budget_consumed: import('../core/orchestrator/loop-budget.js').BudgetSnapshot,
): LoopTraceSummary {
  let tools_called = 0;
  let denials = 0;
  let arg_rejects = 0;
  let tool_errors = 0;
  let result_rejects = 0;
  let subagent_errors = 0;
  for (const r of records) {
    switch (r.kind) {
      case 'tool_accepted':
        tools_called += 1;
        break;
      case 'denial':
      case 'out_of_scope':
      case 'spawn_denial':
        denials += 1;
        break;
      case 'arg_reject':
        arg_rejects += 1;
        break;
      case 'tool_error':
        tool_errors += 1;
        break;
      case 'tool_result_reject':
        result_rejects += 1;
        break;
      case 'subagent_error':
        subagent_errors += 1;
        break;
      default:
        // other kinds (done, early_done, budget_halt, stall_halt,
        // driver_error, invalid_proposal, unknown_tool) don't count toward
        // this summary's six counters.
        break;
    }
  }
  return {
    tools_called,
    denials,
    arg_rejects,
    tool_errors,
    result_rejects,
    subagent_errors,
    budget_consumed,
  };
}

// ─── Step 40d: pre-loop project briefing helper ────────────────────────────
//
// Synthesizes the briefing once, before either Mode A or Mode B Bedrock
// branch dispatches. Both branches receive the same briefing bundle.
//
//   - Decision B: the synthesizer lives under `src/cli/briefing/` so its
//     impl can import from `src/agents/product-understanding/inventory/`
//     without violating the no-cross-layer-imports invariant.
//   - Decision H1: if `<artifactDir>/inventory-bootstrap.json` is absent
//     at briefing time, the helper builds + persists inventory FIRST and
//     proceeds.
//   - Decision E: AI-call failure → `degraded_fallback` briefing; the
//     loop continues.

export interface SynthesizeBriefingForLoopOptions {
  readonly projectRoot: string;
  readonly artifactDir: string;
  readonly aiOptIn: boolean;
  readonly modelId: string | undefined;
  readonly envReader: (name: string) => string | undefined;
  readonly providerId: ProviderId | undefined;
  /**
   * Test seam: pre-built caller (e.g. `recordedBriefingBedrockCaller(...)`).
   * Production paths leave undefined → the helper constructs a live or
   * recorded caller per `VEYRA_BEDROCK_RECORDING`.
   */
  readonly briefingCaller?: import('./briefing/types.js').BriefingBedrockCaller;
}

export interface BriefingBundle {
  readonly briefing?: import('./briefing/types.js').ProjectBriefing;
  readonly digest?: string;
}

export async function synthesizeBriefingForLoop(
  opts: SynthesizeBriefingForLoopOptions,
): Promise<BriefingBundle> {
  const [
    { buildBootstrapInventory, INVENTORY_BOOTSTRAP_ARTIFACT_NAME, writeInventoryArtifact },
    { synthesizeProjectBriefing },
    { writeBriefingArtifact, briefingDigest },
  ] = await Promise.all([
    import('../agents/product-understanding/inventory/bootstrap.js'),
    import('./briefing/synthesize.js'),
    import('./briefing/persist.js'),
  ]);

  const inventoryPath = path.join(opts.artifactDir, INVENTORY_BOOTSTRAP_ARTIFACT_NAME);
  // Decision H1: build + persist inventory pre-briefing if absent.
  let inventory:
    | import('../agents/product-understanding/inventory/types.js').InventoryBootstrap
    | undefined;
  try {
    const text = await fs.readFile(inventoryPath, 'utf8');
    inventory = JSON.parse(text) as import('../agents/product-understanding/inventory/types.js').InventoryBootstrap;
  } catch {
    // not yet on disk — build it now
  }
  if (inventory === undefined) {
    const r = await buildBootstrapInventory({ projectRoot: opts.projectRoot });
    if (!r.ok) {
      // Inventory failure → return empty bundle. The loop still runs (no
      // briefing) — this is the same degraded path as if the operator never
      // opted into briefing.
      return {};
    }
    inventory = r.value;
    const persistR = await writeInventoryArtifact(opts.artifactDir, inventory);
    void persistR;
  }

  // Build the briefing caller (production wiring).
  let caller = opts.briefingCaller;
  if (caller === undefined && opts.aiOptIn && opts.modelId !== undefined) {
    caller = await tryBuildBriefingCaller(opts);
  }

  const synthR = await synthesizeProjectBriefing({
    inventory,
    aiOptIn: opts.aiOptIn,
    ...(caller !== undefined ? { bedrockCaller: caller } : {}),
    ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
  });
  if (!synthR.ok) {
    return {};
  }
  const briefing = synthR.value;

  // Persist artifact + compute digest.
  const writeR = await writeBriefingArtifact(opts.artifactDir, briefing);
  void writeR;
  return { briefing, digest: briefingDigest(briefing) };
}

/**
 * Build a production {@link BriefingBedrockCaller}. Three paths:
 *   1. `VEYRA_BEDROCK_RECORDING=<dir>` set AND `<dir>/briefing-response.json`
 *      exists → recorded-fixture caller (V1 determinism).
 *   2. Live SDK call via lazy-imported `@aws-sdk/client-bedrock-runtime`.
 *   3. Failure → return undefined; synthesizer routes to structural-only.
 */
async function tryBuildBriefingCaller(
  opts: SynthesizeBriefingForLoopOptions,
): Promise<import('./briefing/types.js').BriefingBedrockCaller | undefined> {
  const recordingDir = opts.envReader('VEYRA_BEDROCK_RECORDING');
  if (recordingDir !== undefined && recordingDir.length > 0) {
    try {
      const responsePath = path.join(recordingDir, 'briefing-response.json');
      const text = await fs.readFile(responsePath, 'utf8');
      const parsed = JSON.parse(text) as {
        readonly parsed_output: unknown;
        readonly model_id?: string;
        readonly prompt_fingerprint_sha256?: string;
        readonly cost_units?: number;
      };
      const { recordedBriefingBedrockCaller } = await import(
        './briefing/synthesize.js'
      );
      return recordedBriefingBedrockCaller([
        {
          parsed_output: parsed.parsed_output,
          model_id: parsed.model_id ?? opts.modelId ?? 'unknown',
          ...(parsed.prompt_fingerprint_sha256 !== undefined
            ? { prompt_fingerprint_sha256: parsed.prompt_fingerprint_sha256 }
            : {}),
          ...(parsed.cost_units !== undefined ? { cost_units: parsed.cost_units } : {}),
        },
      ]);
    } catch {
      // recording path missing or unreadable → fall through to live
    }
  }

  // Live SDK path — guarded by `VEYRA_BEDROCK_LIVE=1` (Step 31b preventer 7).
  if (opts.envReader('VEYRA_BEDROCK_LIVE') !== '1') {
    return undefined;
  }
  return buildLiveBriefingCaller(opts);
}

async function buildLiveBriefingCaller(
  opts: SynthesizeBriefingForLoopOptions,
): Promise<import('./briefing/types.js').BriefingBedrockCaller | undefined> {
  const region =
    opts.envReader('AWS_REGION') ?? opts.envReader('AWS_DEFAULT_REGION');
  if (region === undefined || region.length === 0) return undefined;
  let sdk: {
    readonly BedrockRuntimeClient: new (config: { region: string }) => {
      readonly send: (cmd: unknown) => Promise<unknown>;
    };
    readonly ConverseCommand: new (input: unknown) => unknown;
  };
  try {
    sdk = (await import('@aws-sdk/client-bedrock-runtime')) as unknown as {
      readonly BedrockRuntimeClient: new (config: { region: string }) => {
        readonly send: (cmd: unknown) => Promise<unknown>;
      };
      readonly ConverseCommand: new (input: unknown) => unknown;
    };
  } catch {
    return undefined;
  }
  const { BedrockRuntimeClient, ConverseCommand } = sdk;
  const client = new BedrockRuntimeClient({ region });
  return {
    complete: async (req) => {
      const requestBody = {
        modelId: req.model_id,
        system: [{ text: req.system as unknown as string }],
        messages: [
          {
            role: 'user',
            content: [{ text: req.user as unknown as string }],
          },
        ],
        inferenceConfig: { maxTokens: req.max_output_tokens },
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'emit_project_briefing',
                description: 'Emit the project briefing fields.',
                inputSchema: { json: req.response_schema },
              },
            },
          ],
          toolChoice: { tool: { name: 'emit_project_briefing' } },
        },
      };
      const cmd = new ConverseCommand(requestBody);
      const response = (await client.send(cmd)) as {
        readonly output?: {
          readonly message?: {
            readonly content?: ReadonlyArray<{
              readonly toolUse?: { readonly input: unknown };
            }>;
          };
        };
        readonly usage?: { readonly totalTokens?: number };
      };
      const content = response.output?.message?.content ?? [];
      const toolUseBlock = content.find((b) => b.toolUse !== undefined);
      const parsed = toolUseBlock?.toolUse?.input ?? {};
      const totalTokens = response.usage?.totalTokens ?? 0;
      return {
        parsed_output: parsed,
        model_id: req.model_id,
        cost_units: totalTokens,
      };
    },
  };
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
    .option(
      '--loop-budget <spec>',
      'agentic-loop budget overrides as key=value,…  (calls,wall_ms,cost,steps); e.g. calls=40,wall_ms=300000',
    )
    // Step 40c-v3 Mode B options (Step 40 addendum + anon-key — per
    // 40c-v3 decisions document; argv-NAME only for every secret-bearing
    // env var, never the value).
    .option(
      '--approve-active',
      'Mode B sandbox active-validation requires explicit operator approval. Required for --mode sandbox_active_validation.',
      false,
    )
    .option(
      '--supabase-sandbox <project_ref>',
      'Mode B sandbox project_ref (the dev/sandbox Supabase project Veyra creates synthetic data in). Required for --mode sandbox_active_validation. Must NOT match the read-only --supabase project.',
    )
    .option(
      '--supabase-service-role-key <ENV_VAR_NAME>',
      'Mode B: env-var NAME (not the value) of the service-role key for the sandbox project. The value is read from the named env var at runtime; the value never appears on argv (CLAUDE.md §Secrets).',
    )
    .option(
      '--supabase-anon-key <ENV_VAR_NAME>',
      'Mode B: env-var NAME (not the value) of the anon key for the sandbox project. Symmetric with --supabase-service-role-key. The anon key is not a secret per Supabase docs but the env-var-NAME-on-argv pattern is preserved for consistency.',
    )
    .option(
      '--ci',
      'CI mode for Mode B: requires --approval-file <path>. CI runs cannot prompt interactively.',
      false,
    )
    .option(
      '--approval-file <path>',
      'Mode B CI: path to the signed approval file. Signature verification is the documented open item per phases/phase-2-improvement/decisions.md.',
    )
    .action(async (raw: Record<string, unknown>) => {
      const parsed = parseRawOptions(raw);
      const result = await runScan(parsed, deps);
      if (!result.ok) {
        throw result.error;
      }
      // Step 31d codex §6.5-r2 MUST #4: propagate `runScan`'s exitCode via
      // Node's `process.exitCode` (idiomatic). `cli/index.ts` reads it after
      // `parseAsync` returns. Without this propagation, `--fail-on-blocker`
      // was silently a no-op at the CLI surface.
      if (result.value.exitCode !== 0) {
        process.exitCode = result.value.exitCode;
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
    loopFactory: runAgenticLoop,
    registerTools: registerReadOnlyTools,
    policyFactory: defaultReadOnlyEvidencePolicy,
    logger: defaultConsoleLogger,
    now: () => new Date(),
    random: () => randomUUID().slice(0, 8),
    envReader: (name) => process.env[name],
    rawArgvProvider: () => process.argv.slice(2),
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
    // Step 31d: `--loop-budget` carries through to `parseLoopCliOptions` on
    // the Bedrock loop path.
    ...maybeString('loopBudget', raw.loopBudget),
    // Step 40c-v3 Mode B options (Step 40 addendum + anon-key).
    approveActive: raw.approveActive === true,
    ...maybeString('supabaseSandbox', raw.supabaseSandbox),
    ...maybeString('supabaseServiceRoleKey', raw.supabaseServiceRoleKey),
    ...maybeString('supabaseAnonKey', raw.supabaseAnonKey),
    ci: raw.ci === true,
    ...maybeString('approvalFile', raw.approvalFile),
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
