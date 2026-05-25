/**
 * `ContextRequest` — the AI Inference Agent's request for more facts.
 *
 * Per AI-shape revision §5:
 *
 *  - Producer: AI Inference Agent (attaches to a `Hypothesis` via
 *    `Hypothesis.requires_context`).
 *  - Consumer: `ContextPolicyEvaluator` (deterministic gatekeeper;
 *    revision §6.1).
 *  - Lives in this file; written to the `context_requests` artifact when
 *    the agent emits one.
 *
 * The five request kinds are the **only** ways AI can ask for context.
 * Each is matched to a deny-list (revision §5.1) and to mandatory
 * sanitization passes (§5.2) inside the evaluator. AI never holds
 * credentials or calls a connector directly (revision §8 #5).
 *
 * The `kind` discriminator is paired with `args.kind` at the type
 * level — the compiler enforces that the two are equal, so producers
 * cannot construct a request whose top-level `kind` lies about its
 * args.
 */

import type { PromptTemplateId } from './prompt-template.js';

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface ReadFileArgs {
  readonly kind: 'read_file';
  readonly path: string;
  readonly line_range?: LineRange;
}

export interface ListFilesArgs {
  readonly kind: 'list_files';
  readonly scope: string;
}

export interface GetSupabaseTableMetaArgs {
  readonly kind: 'get_supabase_table_meta';
  readonly table_names?: readonly string[];
}

export interface GetSupabaseAdvisorsArgs {
  readonly kind: 'get_supabase_advisors';
}

export interface SendMessageTemplateArgs {
  readonly kind: 'send_message_template';
  readonly template_id: PromptTemplateId;
  readonly slots?: Readonly<Record<string, string>>;
}

export type ContextRequestArgs =
  | ReadFileArgs
  | ListFilesArgs
  | GetSupabaseTableMetaArgs
  | GetSupabaseAdvisorsArgs
  | SendMessageTemplateArgs;

export type ContextRequestKind = ContextRequestArgs['kind'];

interface ContextRequestBase {
  readonly request_id: string;
  readonly for_hypothesis_id: string;
  readonly justification: string;
}

/**
 * Each variant pairs the top-level `kind` with the corresponding
 * `args.kind`, so they cannot drift. Producers must construct a request
 * whose `kind` matches the args it carries.
 */
export type ContextRequest =
  | (ContextRequestBase & { readonly kind: 'read_file'; readonly args: ReadFileArgs })
  | (ContextRequestBase & {
      readonly kind: 'list_files';
      readonly args: ListFilesArgs;
    })
  | (ContextRequestBase & {
      readonly kind: 'get_supabase_table_meta';
      readonly args: GetSupabaseTableMetaArgs;
    })
  | (ContextRequestBase & {
      readonly kind: 'get_supabase_advisors';
      readonly args: GetSupabaseAdvisorsArgs;
    })
  | (ContextRequestBase & {
      readonly kind: 'send_message_template';
      readonly args: SendMessageTemplateArgs;
    });

export function assertExhaustiveContextRequestKind(x: never): never {
  throw new Error(`Unhandled ContextRequestKind: ${JSON.stringify(x)}`);
}
