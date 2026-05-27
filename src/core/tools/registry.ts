import type { ToolResult } from '../../types/tool-result.js';

import {
  type AnyToolDescriptor,
  type ToolDescriptor,
  type ToolDescriptorView,
  toDescriptorView,
} from './descriptor.js';
import type { ToolId } from './tool-id.js';

/** Thrown when a tool id is registered twice. */
export class DuplicateToolIdError extends Error {
  override readonly name = 'DuplicateToolIdError';
}

/**
 * The agentic-loop tool catalog (Phase 3 / Agentic Veyra, PLAN §B). Resolves a
 * {@link ToolId} to a descriptor via a `Map` — there is NO central
 * `switch (tool_id)` and no closed union of tools (FPP §2A). A new tool is
 * registered by the non-core registration layer (Step 33), not by editing core.
 */
export interface ToolRegistry {
  /** Register a descriptor. Throws {@link DuplicateToolIdError} on a repeat id. */
  register<A, R extends ToolResult>(descriptor: ToolDescriptor<A, R>): void;
  /**
   * Resolve a full, runnable descriptor (carries `invoke`). This is the ONLY
   * path that exposes `invoke` — the AI-facing {@link descriptors} view never
   * does.
   */
  resolve(toolId: ToolId): AnyToolDescriptor | undefined;
  /**
   * The AI-facing projection: id + title + args-shape for every registered
   * tool, and never `invoke` / `result_schema` / `source_module`. The loop
   * driver shows this to the model for tool selection (PLAN §B boundary).
   */
  descriptors(): readonly ToolDescriptorView[];
  /** Whether a tool id is registered. */
  has(toolId: ToolId): boolean;
  /** Number of registered tools. */
  size(): number;
}

/** Create an empty in-memory tool registry. */
export function createToolRegistry(): ToolRegistry {
  const byId = new Map<ToolId, AnyToolDescriptor>();

  return {
    register<A, R extends ToolResult>(descriptor: ToolDescriptor<A, R>): void {
      if (byId.has(descriptor.tool_id)) {
        throw new DuplicateToolIdError(
          `tool id already registered: "${descriptor.tool_id}"`,
        );
      }
      // Controlled type-erasure at the registry boundary: the concrete arg
      // type `A` widens to `unknown`. Sound because the loop re-validates
      // proposed args via `args_schema` before calling `invoke`, recovering
      // the type at parse time. `as unknown as` avoids `any` per CLAUDE.md.
      byId.set(descriptor.tool_id, descriptor as unknown as AnyToolDescriptor);
    },

    resolve(toolId: ToolId): AnyToolDescriptor | undefined {
      return byId.get(toolId);
    },

    descriptors(): readonly ToolDescriptorView[] {
      return [...byId.values()].map(toDescriptorView);
    },

    has(toolId: ToolId): boolean {
      return byId.has(toolId);
    },

    size(): number {
      return byId.size;
    },
  };
}
