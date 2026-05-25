/**
 * `ContextPolicyEvaluator` — the Phase 1 deterministic gatekeeper for AI
 * context requests.
 *
 * Per AI-shape revision §5 (deny rules), §5.2 (sanitization order), §5.3
 * (prompt-injection guard), §6.1 (interface):
 *
 *   "Gates AI context requests (§5). Deterministic. Implements the deny
 *    rules from §5.1, the sanitization order from §5.2, and the
 *    prompt-injection guard from §5.3. Returns sanitized `ScanFact[]` on
 *    grant; structured `ContextPolicyError` on deny. Owns retry-counting
 *    per scan; rejects after the configured cap (default 2)."
 *
 * Constraints embedded in the type:
 *
 *  - The grant path produces `readonly ScanFact[]` — facts are the
 *    only currency that crosses the policy boundary (revision §8 #5, #7).
 *  - The denial path is a typed `ContextPolicyError`, never a raw
 *    `throw`, so callers can reason about why a request was rejected.
 *  - Per FPP §2A: connector identities are injected via factory options,
 *    never hardcoded inside `src/core/policy/`.
 *  - Per CLAUDE.md §Validation policy: gate fulfilment on
 *    `policy.allowed_actions.has(...)`, never on `policy.mode`.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { redactSecrets, wrapAsObservedContent } from '../../ai/sanitization.js';
import type { ContextRequest } from '../../types/context-request.js';
import type { ConnectorId } from '../../types/identity.js';
import type { PromptTemplateId } from '../../types/prompt-template.js';
import { type Result, err, ok } from '../../types/result.js';
import type {
  LocalFileSource,
  McpResponseSource,
  ScanFact,
  ScanFactContentKind,
  ScanFactPayload,
} from '../../types/scan-fact.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

/** Structured kinds the evaluator uses on denial. */
export type ContextPolicyErrorKind =
  | 'path_denylisted'
  | 'path_absolute_forbidden'
  | 'path_traversal_forbidden'
  | 'path_outside_project_root'
  | 'extension_denylisted'
  | 'directory_denylisted'
  | 'size_cap_exceeded'
  | 'unknown_template_id'
  | 'wrong_lovable_scope'
  | 'wrong_supabase_project_ref'
  | 'missing_capability'
  | 'fetcher_not_configured'
  | 'fetcher_failed'
  | 'retry_cap_exhausted';

/**
 * Structured error for a denied or failed context request.
 */
export class ContextPolicyError extends Error {
  override readonly name = 'ContextPolicyError';
  public readonly kind: ContextPolicyErrorKind;
  public readonly request_id: string | undefined;

  constructor(
    message: string,
    kind: ContextPolicyErrorKind,
    request_id?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.kind = kind;
    this.request_id = request_id;
  }
}

export interface ContextPolicyEvaluator {
  evaluate(
    request: ContextRequest,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>>;
}

/**
 * Action-logger entry. Per revision §5: log the request_id + category,
 * never the args. The implementation calls the optional `actionLog`
 * callback if provided.
 */
export interface ContextPolicyActionLogEntry {
  readonly request_id: string;
  readonly request_kind: ContextRequest['kind'];
  readonly outcome: 'granted' | 'denied' | 'prompt_injection_flagged';
  readonly reason?: ContextPolicyErrorKind | 'prompt_injection_pattern';
}

/**
 * Injectable fetchers. None are wired in Phase 1's CLI by default;
 * tests supply mock implementations. Real implementations land with
 * the connector steps (15 lovable, 16 supabase).
 */
export interface ContextPolicyFetchers {
  /** Returns the raw bytes of a file under the project root. */
  readonly readFile?: (absolutePath: string) => Promise<string>;
  /** Lists files for a Lovable project. */
  readonly listFiles?: (
    projectId: string,
  ) => Promise<readonly string[]>;
  /**
   * Returns Supabase table metadata. Per CLAUDE.md MCP discipline +
   * REVISION §5.1: every Supabase MCP call requires `read_only=true`
   * AND a `project_ref`. The evaluator passes them explicitly so the
   * fetcher cannot drift to a different mode.
   */
  readonly getSupabaseTableMeta?: (args: {
    readonly projectRef: string;
    readonly readOnly: true;
    readonly tableNames?: readonly string[];
  }) => Promise<string>;
  /** Returns Supabase advisor output (read_only=true enforced). */
  readonly getSupabaseAdvisors?: (args: {
    readonly projectRef: string;
    readonly readOnly: true;
  }) => Promise<string>;
  /**
   * Sends a fixed prompt-template message to Lovable. Per CLAUDE.md
   * MCP discipline: `send_message` is allowed only with `plan_mode`
   * AND a fixed template id. The evaluator constructs both
   * unconditionally.
   */
  readonly sendMessageTemplate?: (args: {
    readonly templateId: PromptTemplateId;
    readonly planMode: true;
    readonly slots?: Readonly<Record<string, string>>;
  }) => Promise<string>;
}

export interface ContextPolicyEvaluatorOptions {
  readonly projectRoot: string;
  readonly maxRetriesPerScan?: number;
  readonly maxFileBytes?: number;
  readonly fetchers: ContextPolicyFetchers;
  /**
   * Connector ids the evaluator stamps onto emitted facts. Per FPP §2A:
   * the policy module never names `'lovable' | 'supabase'`; the caller
   * provides the registry-resolved branded ids.
   */
  readonly lovableConnectorId?: ConnectorId;
  readonly supabaseConnectorId?: ConnectorId;
  readonly lovableProjectId?: string;
  readonly supabaseProjectRef?: string;
  readonly actionLog?: (entry: ContextPolicyActionLogEntry) => void;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_FILE_BYTES = 200 * 1024;

const PATH_DENY_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.env$/i,
  /(^|\/)credentials/i,
  /(^|\/)secrets/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
];

const EXT_DENYLIST: readonly string[] = [
  '.bin',
  '.exe',
  '.so',
  '.dll',
  '.jar',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.png',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.ico',
  '.woff',
  '.woff2',
];

const DIR_DENYLIST: readonly string[] = [
  'dist',
  'build',
  'node_modules',
  '.next',
  'coverage',
  'out',
];

const ALLOWED_TEMPLATE_IDS: readonly string[] = [
  'templates.project_overview',
  'templates.user_flows',
  'templates.data_handling',
  'templates.auth_model',
];

/**
 * Patterns that hint at a prompt-injection attempt inside fetched
 * content. Per revision §5.3: do NOT block at fetch time; flag in the
 * action log so the inference agent can decide.
 */
const PROMPT_INJECTION_HINTS: readonly RegExp[] = [
  /<observed_content>/i,
  /<\/observed_content>/i,
  /ignore (all )?previous instructions/i,
  /you are now/i,
  /system:\s*role/i,
];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildFactId(request: ContextRequest, suffix: string): string {
  return sha256(`${request.request_id}:${suffix}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Run the §5.2 sanitization pipeline AND the §5.3 prompt-injection
 * wrap. Three passes:
 *
 *   1. `redactSecrets(raw)` — storage pass.
 *   2. `redactSecrets(stored)` — AI-input pass (idempotent, defense in
 *      depth for any pattern added between passes).
 *   3. `wrapAsObservedContent(twice_sanitized, factId)` — labels the
 *      content as data, not instructions. Per revision §5.3 every
 *      fetched block is wrapped with delimiters before AI ever sees it.
 *
 * The wrapped form is what the evaluator stores in
 * `ScanFact.payload.sanitized_excerpt`. The delimiters are part of the
 * audit record — a reviewer reading scan-facts.json can see that the
 * content was fetched, sanitized, and labelled before any AI consumer
 * read it.
 */
function sanitizeAndWrap(raw: string, factId: string): string {
  const storagePass = redactSecrets(raw);
  const aiInputPass = redactSecrets(storagePass);
  return wrapAsObservedContent(aiInputPass, factId);
}

function looksLikePromptInjection(content: string): boolean {
  return PROMPT_INJECTION_HINTS.some((re) => re.test(content));
}

function denyError(
  kind: ContextPolicyErrorKind,
  message: string,
  requestId: string,
): ContextPolicyError {
  return new ContextPolicyError(message, kind, requestId);
}

function checkCapability(
  action: AllowedAction,
  policy: ValidationPolicy,
  requestId: string,
): ContextPolicyError | null {
  if (policy.allowed_actions.has(action)) {
    return null;
  }
  return denyError(
    'missing_capability',
    `Action "${action}" is not in policy.allowed_actions`,
    requestId,
  );
}

function checkReadFilePath(
  rawPath: string,
  projectRoot: string,
  requestId: string,
): { abs: string; relative: string } | ContextPolicyError {
  if (path.isAbsolute(rawPath)) {
    return denyError(
      'path_absolute_forbidden',
      `--read_file requires a project-relative path; got absolute "${rawPath}"`,
      requestId,
    );
  }
  if (rawPath.includes('..')) {
    return denyError(
      'path_traversal_forbidden',
      `--read_file refuses ".." segments: "${rawPath}"`,
      requestId,
    );
  }
  const resolved = path.resolve(projectRoot, rawPath);
  const rel = path.relative(projectRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return denyError(
      'path_outside_project_root',
      `--read_file path resolves outside project root: "${rawPath}"`,
      requestId,
    );
  }
  for (const re of PATH_DENY_PATTERNS) {
    if (re.test(rel) || re.test(rawPath)) {
      return denyError(
        'path_denylisted',
        `--read_file path matches denylist: "${rawPath}"`,
        requestId,
      );
    }
  }
  const ext = path.extname(rawPath).toLowerCase();
  if (EXT_DENYLIST.includes(ext)) {
    return denyError(
      'extension_denylisted',
      `--read_file extension "${ext}" is denylisted`,
      requestId,
    );
  }
  const parts = rel.split(path.sep);
  for (const dir of DIR_DENYLIST) {
    if (parts.includes(dir)) {
      return denyError(
        'directory_denylisted',
        `--read_file refuses paths under "${dir}/": "${rawPath}"`,
        requestId,
      );
    }
  }
  return { abs: resolved, relative: rel };
}

function buildLocalFileFact(
  request: ContextRequest,
  filePath: string,
  raw: string,
): ScanFact {
  const factId = buildFactId(request, filePath);
  const wrapped = sanitizeAndWrap(raw, factId);
  const redacted = wrapped.replace(/<\/?observed_content[^>]*>/g, '') !== raw;
  const source: LocalFileSource = {
    kind: 'local_file',
    signal_kind: 'context_request_read_file',
    payload: {
      sanitized_excerpt: wrapped,
      content_kind: 'text',
      source_artifact_path: filePath,
    },
  };
  return {
    fact_id: factId,
    source,
    file_path: filePath,
    observed_at: nowIso(),
    args_fingerprint_sha256: sha256(JSON.stringify(request.args)),
    redacted,
  };
}

function buildMcpFact(
  request: ContextRequest,
  connectorId: ConnectorId,
  tool: string,
  contentKind: ScanFactContentKind,
  raw: string,
): ScanFact {
  const factId = buildFactId(request, `${tool}:${String(raw.length)}`);
  const wrapped = sanitizeAndWrap(raw, factId);
  const redacted = wrapped.replace(/<\/?observed_content[^>]*>/g, '') !== raw;
  const payload: ScanFactPayload = {
    sanitized_excerpt: wrapped,
    content_kind: contentKind,
  };
  const source: McpResponseSource = {
    kind: 'mcp_response',
    connector_id: connectorId,
    tool,
    response_digest: sha256(wrapped),
    payload,
  };
  return {
    fact_id: factId,
    source,
    observed_at: nowIso(),
    args_fingerprint_sha256: sha256(JSON.stringify(request.args)),
    redacted,
  };
}

class ContextPolicyEvaluatorImpl implements ContextPolicyEvaluator {
  readonly #options: ContextPolicyEvaluatorOptions;
  readonly #maxRetries: number;
  readonly #maxFileBytes: number;
  #retryCount = 0;

  constructor(options: ContextPolicyEvaluatorOptions) {
    this.#options = options;
    this.#maxRetries = options.maxRetriesPerScan ?? DEFAULT_MAX_RETRIES;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async evaluate(
    request: ContextRequest,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    // Retry cap: the Nth+1 evaluation rejects.
    if (this.#retryCount >= this.#maxRetries) {
      const e = denyError(
        'retry_cap_exhausted',
        `Context-request retry cap exhausted (${String(this.#maxRetries)})`,
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    this.#retryCount += 1;

    switch (request.kind) {
      case 'read_file':
        return this.#evaluateReadFile(request, policy);
      case 'list_files':
        return this.#evaluateListFiles(request, policy);
      case 'get_supabase_table_meta':
        return this.#evaluateSupabaseTables(request, policy);
      case 'get_supabase_advisors':
        return this.#evaluateSupabaseAdvisors(request, policy);
      case 'send_message_template':
        return this.#evaluateSendMessage(request, policy);
    }
  }

  async #evaluateReadFile(
    request: Extract<ContextRequest, { kind: 'read_file' }>,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    const cap = checkCapability('read_code', policy, request.request_id);
    if (cap !== null) {
      this.#log(request, 'denied', cap.kind);
      return err(cap);
    }
    const pathCheck = checkReadFilePath(
      request.args.path,
      this.#options.projectRoot,
      request.request_id,
    );
    if (pathCheck instanceof ContextPolicyError) {
      this.#log(request, 'denied', pathCheck.kind);
      return err(pathCheck);
    }
    const reader = this.#options.fetchers.readFile;
    if (reader === undefined) {
      const e = denyError(
        'fetcher_not_configured',
        'read_file fetcher is not configured for this evaluator',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    let raw: string;
    try {
      raw = await reader(pathCheck.abs);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const e = new ContextPolicyError(
        `read_file fetcher failed: ${message}`,
        'fetcher_failed',
        request.request_id,
        cause instanceof Error ? { cause } : undefined,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    if (Buffer.byteLength(raw, 'utf8') > this.#maxFileBytes) {
      const e = denyError(
        'size_cap_exceeded',
        `read_file content exceeds ${String(this.#maxFileBytes)} bytes`,
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    if (looksLikePromptInjection(raw)) {
      this.#log(request, 'prompt_injection_flagged', 'prompt_injection_pattern');
    }
    const fact = buildLocalFileFact(request, pathCheck.relative, raw);
    this.#log(request, 'granted');
    return ok([fact]);
  }

  async #evaluateListFiles(
    request: Extract<ContextRequest, { kind: 'list_files' }>,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    const cap = checkCapability('read_code', policy, request.request_id);
    if (cap !== null) {
      this.#log(request, 'denied', cap.kind);
      return err(cap);
    }
    const projectId = this.#options.lovableProjectId;
    if (projectId === undefined || projectId !== request.args.scope) {
      const e = denyError(
        'wrong_lovable_scope',
        'list_files scope must equal the configured Lovable project id',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    const connectorId = this.#options.lovableConnectorId;
    const fetcher = this.#options.fetchers.listFiles;
    if (connectorId === undefined || fetcher === undefined) {
      const e = denyError(
        'fetcher_not_configured',
        'list_files connector or fetcher is not configured',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    let listing: readonly string[];
    try {
      listing = await fetcher(projectId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const e = new ContextPolicyError(
        `list_files fetcher failed: ${message}`,
        'fetcher_failed',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    const joined = listing.join('\n');
    const fact = buildMcpFact(request, connectorId, 'list_files', 'text', joined);
    this.#log(request, 'granted');
    return ok([fact]);
  }

  async #evaluateSupabaseTables(
    request: Extract<ContextRequest, { kind: 'get_supabase_table_meta' }>,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    const cap = checkCapability('read_schema_metadata', policy, request.request_id);
    if (cap !== null) {
      this.#log(request, 'denied', cap.kind);
      return err(cap);
    }
    const projectRef = this.#options.supabaseProjectRef;
    const connectorId = this.#options.supabaseConnectorId;
    const fetcher = this.#options.fetchers.getSupabaseTableMeta;
    if (projectRef === undefined || connectorId === undefined || fetcher === undefined) {
      const e = denyError(
        'fetcher_not_configured',
        'get_supabase_table_meta connector / fetcher / project_ref is not configured',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    let raw: string;
    try {
      raw = await fetcher({
        projectRef,
        readOnly: true,
        ...(request.args.table_names !== undefined
          ? { tableNames: request.args.table_names }
          : {}),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const e = new ContextPolicyError(
        `get_supabase_table_meta fetcher failed: ${message}`,
        'fetcher_failed',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    const fact = buildMcpFact(request, connectorId, 'list_tables', 'json', raw);
    this.#log(request, 'granted');
    return ok([fact]);
  }

  async #evaluateSupabaseAdvisors(
    request: Extract<ContextRequest, { kind: 'get_supabase_advisors' }>,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    const cap = checkCapability('read_schema_metadata', policy, request.request_id);
    if (cap !== null) {
      this.#log(request, 'denied', cap.kind);
      return err(cap);
    }
    const projectRef = this.#options.supabaseProjectRef;
    const connectorId = this.#options.supabaseConnectorId;
    const fetcher = this.#options.fetchers.getSupabaseAdvisors;
    if (projectRef === undefined || connectorId === undefined || fetcher === undefined) {
      const e = denyError(
        'fetcher_not_configured',
        'get_supabase_advisors connector / fetcher / project_ref is not configured',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    let raw: string;
    try {
      raw = await fetcher({ projectRef, readOnly: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const e = new ContextPolicyError(
        `get_supabase_advisors fetcher failed: ${message}`,
        'fetcher_failed',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    const fact = buildMcpFact(request, connectorId, 'get_advisors', 'json', raw);
    this.#log(request, 'granted');
    return ok([fact]);
  }

  async #evaluateSendMessage(
    request: Extract<ContextRequest, { kind: 'send_message_template' }>,
    policy: ValidationPolicy,
  ): Promise<Result<readonly ScanFact[], ContextPolicyError>> {
    const cap = checkCapability('read_code', policy, request.request_id);
    if (cap !== null) {
      this.#log(request, 'denied', cap.kind);
      return err(cap);
    }
    if (!ALLOWED_TEMPLATE_IDS.includes(request.args.template_id)) {
      const e = denyError(
        'unknown_template_id',
        `send_message_template id "${request.args.template_id as string}" is not one of the four allowed templates`,
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    const connectorId = this.#options.lovableConnectorId;
    const fetcher = this.#options.fetchers.sendMessageTemplate;
    if (connectorId === undefined || fetcher === undefined) {
      const e = denyError(
        'fetcher_not_configured',
        'send_message_template connector / fetcher is not configured',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    let raw: string;
    try {
      raw = await fetcher({
        templateId: request.args.template_id,
        planMode: true,
        ...(request.args.slots !== undefined ? { slots: request.args.slots } : {}),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const e = new ContextPolicyError(
        `send_message_template fetcher failed: ${message}`,
        'fetcher_failed',
        request.request_id,
      );
      this.#log(request, 'denied', e.kind);
      return err(e);
    }
    if (looksLikePromptInjection(raw)) {
      this.#log(request, 'prompt_injection_flagged', 'prompt_injection_pattern');
    }
    const fact = buildMcpFact(request, connectorId, 'send_message', 'text', raw);
    this.#log(request, 'granted');
    return ok([fact]);
  }

  #log(
    request: ContextRequest,
    outcome: ContextPolicyActionLogEntry['outcome'],
    reason?: ContextPolicyActionLogEntry['reason'],
  ): void {
    const cb = this.#options.actionLog;
    if (cb === undefined) return;
    cb({
      request_id: request.request_id,
      request_kind: request.kind,
      outcome,
      ...(reason !== undefined ? { reason } : {}),
    });
  }
}

export function createContextPolicyEvaluator(
  options: ContextPolicyEvaluatorOptions,
): ContextPolicyEvaluator {
  return new ContextPolicyEvaluatorImpl(options);
}
