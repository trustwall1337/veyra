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

import { redactSecrets } from '../../ai/sanitization.js';
import { PolicyViolationError } from '../../types/errors.js';
import type { PromptTemplateId } from '../../types/prompt-template.js';
import { type Result, err, ok } from '../../types/result.js';

import { canonicalTextFor } from './prompt-templates.js';
import {
  LOVABLE_CONNECTOR_ID,
  checkSendMessageArgs,
  checkToolAllowed,
  type SendMessageArgs,
} from './policy.js';

export class LovableTransportError extends Error {
  override readonly name = 'LovableTransportError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type LovableClientError = PolicyViolationError | LovableTransportError;

/**
 * Retro-15 f5: response redaction. Walks the response object/array
 * tree and runs redactSecrets on every string leaf. Preserves the
 * object shape so downstream consumers (product-understanding,
 * supabase-rls) see the same structure they would have seen, minus
 * raw secrets.
 */
function redactResponse(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactResponse);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactResponse(v);
    }
    return out;
  }
  return value;
}

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
  ): Promise<Result<unknown, LovableClientError>> {
    const allowed = checkToolAllowed(tool);
    if (!allowed.ok) return allowed;
    let raw: unknown;
    try {
      if (tool === 'send_message') {
        const checked = checkSendMessageArgs(args);
        if (!checked.ok) return checked;
        raw = await this.#transport.invokeTool('send_message', {
          project_id: this.#projectId,
          template_id: checked.value.template_id,
          message: canonicalTextFor(checked.value.template_id as PromptTemplateId) ?? '',
          plan_mode: true,
        });
      } else {
        raw = await this.#transport.invokeTool(tool, {
          project_id: this.#projectId,
          ...args,
        });
      }
    } catch (cause) {
      // Retro-15 f7: transport exceptions become typed errors so the
      // Result-returning contract isn't broken by an upstream throw.
      const m = cause instanceof Error ? cause.message : String(cause);
      return err(new LovableTransportError(`Lovable transport failed for "${tool}": ${m}`, cause));
    }
    // Retro-15 f5: redact response leaves before returning.
    return ok(redactResponse(raw));
  }

  // Convenience typed shims. These wrap `invoke` with named args.
  getProject(): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('get_project', {});
  }

  listFiles(): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('list_files', {});
  }

  readFile(filePath: string): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('read_file', { path: filePath });
  }

  listEdits(): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('list_edits', {});
  }

  getDiff(editId: string): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('get_diff', { edit_id: editId });
  }

  sendMessage(
    args: SendMessageArgs,
  ): Promise<Result<unknown, LovableClientError>> {
    return this.invoke('send_message', args as unknown as Readonly<Record<string, unknown>>);
  }
}

export function createLovableClient(
  options: LovableClientOptions,
): LovableClient {
  return new LovableClient(options);
}
