import type { ZodType } from 'zod';

import type { Result } from '../../types/result.js';
import type { ToolResult } from '../../types/tool-result.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

import type { ToolId } from './tool-id.js';

/**
 * Error returned (not thrown) by a tool's `invoke` on an expected failure.
 * The agentic loop turns this into a `tool_error` fact + artifact and
 * continues (PLAN §B per-tool failure boundary). Reserve `throw` for the
 * unexpected; the loop's per-tool `try/catch` records those too.
 */
export class ToolInvocationError extends Error {
  /**
   * Override the inherited `Error.name`. Typed as `string` (not the literal)
   * so concrete subclasses (e.g. 40e's ClassificationKeyInArgsError) can
   * specialize the name. The loop reads `error.name` for the trace row's
   * `tool_error_class` audit field.
   */
  override readonly name: string = 'ToolInvocationError';
}

/**
 * Minimal run context handed to a tool's `invoke`. Deliberately small and
 * stable: it carries only the scan identity and the project root every tool
 * needs. Step 31 (loop driver) extends this with runtime-specific fields — it
 * MUST NOT be widened here with policy-gate, budget, artifact-state, or
 * loop-driver fields (those are step 31's, kept out of the core abstraction so
 * the descriptor contract stays stable). [codex F3]
 */
export interface ToolContext {
  readonly scanId: string;
  readonly projectPath: string;
  /**
   * Per-scan artifact directory (codex p3-r1-007). Optional so existing tools
   * (gitleaks, read-code, ...) can ignore it; tools that produce a named
   * artifact for the §K ledger (e.g. `read-schema-meta` writing
   * `database-metadata.json`) use it. The loop populates this from the same
   * `artifactDir` it hands to `ArtifactState` and the trace writer.
   */
  readonly artifactDir?: string;
}

/**
 * A tool the agentic loop can call (Phase 3 / Agentic Veyra, PLAN §B). Core
 * owns only this contract; concrete descriptors whose `invoke` imports a
 * scanner/connector/agent live in leaf folders and are wired by the non-core
 * registration layer (Step 33). Per FPP §2A there is no closed union of tools.
 *
 * @typeParam A - the parsed argument shape (validated by `args_schema`).
 * @typeParam R - the result shape (validated by `result_schema`); always a
 *   {@link ToolResult}, so it can never carry a classification verdict.
 */
export interface ToolDescriptor<
  A = unknown,
  R extends ToolResult = ToolResult,
> {
  /** Opaque branded id; unique within a registry. */
  readonly tool_id: ToolId;
  /** Human-readable title shown in the AI-facing descriptor view. */
  readonly title: string;
  /** Zod schema the loop parses proposed args against before `invoke`. */
  readonly args_schema: ZodType<A>;
  /**
   * Zod schema the loop parses the `invoke` return against BEFORE the result
   * may persist or feed the deterministic floor (PLAN §D.1). Concrete tools
   * compose `toolResultBaseSchema` so a classification key is rejected.
   */
  readonly result_schema: ZodType<R>;
  /**
   * Policy action this tool requires. The policy gate authorizes the call iff
   * `policy.allowed_actions.has(required_action)` — never by mode string
   * (CLAUDE.md §Validation policy). Reuses the existing `AllowedAction`
   * vocabulary; not a provider name.
   */
  readonly required_action: AllowedAction;
  /**
   * Module path where this concrete descriptor is defined (e.g.
   * `src/scanners/gitleaks/tool.ts`). The Step 35 import-graph walk derives its
   * entrypoint set from the registered descriptors' `source_module`, so a
   * newly-registered tool is automatically in scope (PLAN §D.2(iii)). Set by
   * the leaf descriptor in Step 33; not exposed in the AI-facing view.
   */
  readonly source_module: string;
  /**
   * Execute the tool. Returns a `Result` on expected failure; redacts any
   * secret before returning (CLAUDE.md §Secrets). The loop parses the returned
   * value against `result_schema` before it persists.
   */
  readonly invoke: (
    args: A,
    context: ToolContext,
    policy: ValidationPolicy,
  ) => Promise<Result<R, ToolInvocationError>>;
  /**
   * Step 39b Decision H (codex 39b-002 [APPLIED]): optional dynamic-gate
   * hook. When set, the policy gate parses `args` first, then calls this
   * hook to derive the effective capability set, then enforces ALL
   * declared actions against `policy.allowed_actions`. Returns an empty
   * array (or a sentinel) to force a deny (e.g. unknown probe_id).
   *
   * Descriptors WITHOUT this hook keep the existing static-action-before-
   * parse behavior (no behavioral change for existing tools).
   * Path-selection in the loop: `descriptor.requiredActionForArgs !==
   * undefined`.
   */
  readonly requiredActionForArgs?: (args: A) => readonly AllowedAction[];
}

/**
 * Type-erased descriptor as stored in the registry. Args are widened to
 * `unknown` because the loop re-validates proposed args via `args_schema`
 * before calling `invoke` — the concrete arg type is recovered at parse time,
 * not at the registry boundary.
 */
export type AnyToolDescriptor = ToolDescriptor<unknown, ToolResult>;

/**
 * The AI-facing projection of a descriptor: id, title, and the input-shape
 * schema ONLY — never `invoke`, `result_schema`, or `source_module`. The loop
 * driver shows this to the model for tool selection; the runnable descriptor is
 * reachable only via the registry's `resolve()` (PLAN §B; Step 30 boundary).
 */
export interface ToolDescriptorView {
  readonly tool_id: ToolId;
  readonly title: string;
  readonly args_schema: ZodType<unknown>;
}

/** Project a full descriptor down to its AI-facing view. */
export function toDescriptorView(
  descriptor: AnyToolDescriptor,
): ToolDescriptorView {
  return {
    tool_id: descriptor.tool_id,
    title: descriptor.title,
    args_schema: descriptor.args_schema,
  };
}
