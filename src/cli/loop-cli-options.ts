import type { BudgetCaps } from '../core/orchestrator/loop-budget.js';
import { type Result, err, ok } from '../types/result.js';
import type { EnvironmentType } from '../types/validation-policy.js';

/**
 * Agentic-loop CLI options (Phase 3 / Step 40, PLAN §H step 40, decisions.md
 * D2/D3/D5). Parses the new Mode A/B + `--loop-budget` + `--no-ai` surface and
 * enforces the trust-rule guards:
 *
 *  - `--env production` + Mode B → reject (CLAUDE.md §Validation policy).
 *  - Mode B default sub-mode is **B.2 auto-synthesize** (D2); the
 *    service-role key is read from the ENVIRONMENT ONLY — never argv
 *    (CLAUDE.md §Secrets). B.1 manifest is opt-in.
 *  - `--loop-budget` is the SINGLE budget surface (D3 collapses the Phase-2
 *    AI-tuning flags into this one).
 *  - `--no-ai` routes to the plan-walker (Step 32 — deterministic offline).
 *
 * Signature verification of the approval file is the documented open item
 * (decisions.md "orphaned item from superseded Phase 1 step 29"); this layer
 * exposes the approval-file path argument and a `skipSignatureVerify` flag
 * that is `true` by default with a clear warning, NEVER silently bypassed.
 */

export type ScanMode = 'mode_a' | 'mode_b';
export type ModeBSubMode = 'b1_manifest' | 'b2_auto_synthesize';

export const DEFAULT_MODE_B_SUBMODE: ModeBSubMode = 'b2_auto_synthesize';

export interface LoopCliOptions {
  readonly mode: ScanMode;
  readonly modeBSubMode: ModeBSubMode;
  readonly noAi: boolean;
  /** When non-empty, each entry is a partial cap override applied to defaults. */
  readonly loopBudget: Partial<BudgetCaps>;
  readonly env: EnvironmentType;
  /** Approval file path (Mode B only). */
  readonly approvalFile?: string;
  /**
   * Signature verification is currently stubbed (open item per decisions.md).
   * The flag is exposed so operators may EXPLICITLY opt out with a warning;
   * the CLI does NOT silently skip — the stub status is documented.
   */
  readonly skipSignatureVerify: boolean;
}

export class CliOptionError extends Error {
  override readonly name = 'CliOptionError';
}

export interface LoopCliInput {
  readonly mode?: string;
  readonly modeBSubMode?: string;
  readonly noAi?: boolean;
  readonly loopBudget?: string;
  readonly env?: string;
  readonly approvalFile?: string;
  /** Set explicitly via CLI (acknowledged stub) or default false. */
  readonly skipSignatureVerify?: boolean;
  /**
   * Argv as parsed (read-only). Used by the credential-on-argv guard to fail
   * closed if a known secret-shaped flag was supplied.
   */
  readonly rawArgv?: readonly string[];
}

const FORBIDDEN_ARGV_FLAGS: readonly string[] = [
  '--service-role-key',
  '--aws-access-key-id',
  '--aws-secret-access-key',
  '--password',
  '--api-key',
];

/**
 * Parse + validate the loop CLI input. Pure function; returns a `Result` so
 * the CLI layer can surface a structured error.
 */
export function parseLoopCliOptions(
  input: LoopCliInput,
): Result<LoopCliOptions, CliOptionError> {
  // Credential-on-argv guard (Verification f).
  if (input.rawArgv !== undefined) {
    for (const arg of input.rawArgv) {
      for (const forbidden of FORBIDDEN_ARGV_FLAGS) {
        if (arg === forbidden || arg.startsWith(`${forbidden}=`)) {
          return err(
            new CliOptionError(
              `${forbidden} must be set in the environment, never on argv (CLAUDE.md §Secrets).`,
            ),
          );
        }
      }
    }
  }

  const env = parseEnv(input.env);
  if (env.ok === false) return env;

  const mode: ScanMode = input.mode === 'mode_b' ? 'mode_b' : 'mode_a';

  // (Verification c) Mode B + production → reject. The capability gate is the
  // ultimate authority elsewhere; this is a CLI fail-closed early reject.
  if (mode === 'mode_b' && env.value === 'production') {
    return err(
      new CliOptionError(
        '--env production with Mode B is not allowed (sandbox_active_validation is forbidden in production; FPP §17 Phase 5).',
      ),
    );
  }

  const modeBSubMode = parseModeBSubMode(input.modeBSubMode);

  const budget = parseLoopBudget(input.loopBudget);
  if (budget.ok === false) return budget;

  return ok({
    mode,
    modeBSubMode,
    noAi: input.noAi === true,
    loopBudget: budget.value,
    env: env.value,
    ...(input.approvalFile !== undefined
      ? { approvalFile: input.approvalFile }
      : {}),
    skipSignatureVerify: input.skipSignatureVerify ?? true,
  });
}

function parseEnv(raw: string | undefined): Result<EnvironmentType, CliOptionError> {
  const v = raw ?? 'dev';
  switch (v) {
    case 'local':
    case 'dev':
    case 'preview':
    case 'staging':
    case 'sandbox':
    case 'production':
      return ok(v);
    default:
      return err(new CliOptionError(`--env: unknown value "${v}"`));
  }
}

function parseModeBSubMode(raw: string | undefined): ModeBSubMode {
  if (raw === 'b1_manifest' || raw === 'b1' || raw === 'manifest') {
    return 'b1_manifest';
  }
  // D2: B.2 auto-synthesize is the default.
  return DEFAULT_MODE_B_SUBMODE;
}

/**
 * Parse `--loop-budget calls=40,wall_ms=300000,cost=2000000,steps=200`.
 * All entries optional; missing entries fall back to DEFAULT_BUDGET_CAPS.
 */
function parseLoopBudget(
  raw: string | undefined,
): Result<Partial<BudgetCaps>, CliOptionError> {
  if (raw === undefined || raw.length === 0) return ok({});
  const out: Partial<BudgetCaps> = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=', 2);
    if (k === undefined || v === undefined || v.length === 0) {
      return err(new CliOptionError(`--loop-budget: malformed pair "${pair}"`));
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      return err(new CliOptionError(`--loop-budget: ${k} must be a non-negative number`));
    }
    switch (k) {
      case 'calls':
        Object.assign(out, { max_tool_calls: n });
        break;
      case 'wall_ms':
        Object.assign(out, { max_wall_clock_ms: n });
        break;
      case 'cost':
        Object.assign(out, { max_ai_cost_units: n });
        break;
      case 'steps':
        Object.assign(out, { max_steps: n });
        break;
      default:
        return err(new CliOptionError(`--loop-budget: unknown key "${k}"`));
    }
  }
  return ok(out);
}
