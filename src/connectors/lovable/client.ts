/**
 * Lovable MCP connector client (thin policy gate over an injectable
 * transport).
 *
 * Per PHASE_1_PLAN §7 Task 7 + CLAUDE.md §MCP discipline:
 *  - Allowlist-only: tools outside ALLOWED_LOVABLE_TOOLS auto-deny.
 *  - send_message requires plan_mode=true + a fixed template_id.
 *  - The connector contains no security reasoning — it returns raw
 *    responses for downstream consumers (product-understanding agent).
 *
 * The MCP SDK transport is injected so tests can run hermetically.
 * Production wiring lands when CLI integration is finalised.
 */

import { PolicyViolationError } from '../../types/errors.js';
import type { PromptTemplateId } from '../../types/prompt-template.js';
import { type Result, ok } from '../../types/result.js';

import { canonicalTextFor } from './prompt-templates.js';
import {
  LOVABLE_CONNECTOR_ID,
  checkSendMessageArgs,
  checkToolAllowed,
  type SendMessageArgs,
} from './policy.js';

export interface LovableTransport {
  invokeTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface LovableClientOptions {
  readonly transport: LovableTransport;
  readonly projectId: string;
}

export class LovableClient {
  readonly #transport: LovableTransport;
  readonly #projectId: string;

  constructor(options: LovableClientOptions) {
    this.#transport = options.transport;
    this.#projectId = options.projectId;
  }

  get connectorId() {
    return LOVABLE_CONNECTOR_ID;
  }

  get projectId(): string {
    return this.#projectId;
  }

  async invoke(
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Result<unknown, PolicyViolationError>> {
    const allowed = checkToolAllowed(tool);
    if (!allowed.ok) return allowed;
    if (tool === 'send_message') {
      const checked = checkSendMessageArgs(args);
      if (!checked.ok) return checked;
      return ok(
        await this.#transport.invokeTool('send_message', {
          project_id: this.#projectId,
          template_id: checked.value.template_id,
          message: canonicalTextFor(checked.value.template_id as PromptTemplateId) ?? '',
          plan_mode: true,
          ...(checked.value.slots !== undefined
            ? { slots: checked.value.slots }
            : {}),
        }),
      );
    }
    return ok(
      await this.#transport.invokeTool(tool, { project_id: this.#projectId, ...args }),
    );
  }

  // Convenience typed shims. These wrap `invoke` with named args.
  getProject(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('get_project', {});
  }

  listFiles(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('list_files', {});
  }

  readFile(filePath: string): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('read_file', { path: filePath });
  }

  listEdits(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('list_edits', {});
  }

  getDiff(editId: string): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('get_diff', { edit_id: editId });
  }

  sendMessage(
    args: SendMessageArgs,
  ): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('send_message', args as unknown as Readonly<Record<string, unknown>>);
  }
}

export function createLovableClient(
  options: LovableClientOptions,
): LovableClient {
  return new LovableClient(options);
}
