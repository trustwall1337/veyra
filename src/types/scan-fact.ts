/**
 * `ScanFact` — deterministic observation record.
 *
 * Per AI-shape revision §3.1:
 *
 *  - Producers: scanners (gitleaks, OSV, semgrep), parsers (Supabase
 *    schema, route-map extraction), connectors (Lovable MCP, Supabase MCP).
 *  - Consumers: AI Inference Layer (§3.2), Assertion Layer (§3.3),
 *    `ContextPolicyEvaluator` retries.
 *  - Lives in this file; written to the `scan_facts` artifact.
 *
 * The discriminator (`source.kind`) uses **generic** names; specific
 * scanners / connectors / parsers are named via opaque branded IDs
 * (`ScannerId`, `ConnectorId`, `ParserId`) per `FPP §2A` rule 1. Adding
 * a new scanner is a registry edit + a new `ScannerId` value, not a
 * shared-type edit.
 *
 * `ScanFact` is **observation, not interpretation.** "Table `orders`
 * has no `ALTER ... ENABLE ROW LEVEL SECURITY` statement" is a fact.
 * "Therefore RLS is off on `orders`" is a Finding decided by the
 * assertion layer.
 */

import type { ConnectorId, ParserId, ScannerId } from './identity.js';

/**
 * Closed enum for the `content_kind` discriminator on `ScanFactPayload`.
 * Adding a new content kind is a deliberate, audited change — every
 * downstream switch over `content_kind` will fail to compile until it
 * adds a case (see `assertExhaustiveScanFactContentKind`).
 */
export type ScanFactContentKind =
  | 'text'
  | 'sql'
  | 'json'
  | 'yaml'
  | 'redacted_secret_context';

/**
 * Sanitized payload attached to a `ScanFact` when the fact's content
 * needs to be inspectable by the AI Inference Layer. The excerpt has
 * already been passed through the storage-sanitization pass per
 * revision §5.2 step 1; the AI prompt-construction pass runs again
 * before the value reaches a provider.
 */
export interface ScanFactPayload {
  readonly sanitized_excerpt: string;
  readonly content_kind: ScanFactContentKind;
  readonly byte_range?: { readonly start: number; readonly end: number };
  readonly source_artifact_path?: string;
}

export interface ScannerMatchSource {
  readonly kind: 'scanner_match';
  readonly scanner_id: ScannerId;
  readonly payload: ScanFactPayload;
}

export interface SchemaElementSource {
  readonly kind: 'schema_element';
  readonly parser_id: ParserId;
  readonly element_kind: string;
  readonly name: string;
}

export interface McpResponseSource {
  readonly kind: 'mcp_response';
  readonly connector_id: ConnectorId;
  readonly tool: string;
  readonly response_digest: string;
  readonly payload?: ScanFactPayload;
}

export interface LocalFileSource {
  readonly kind: 'local_file';
  readonly signal_kind: string;
  readonly payload?: ScanFactPayload;
}

/**
 * Discriminated union over the *generic* observation kinds. The
 * discriminator value is intentionally NOT a provider name — provider
 * identity lives in the opaque `*_id` fields per `FPP §2A` rule 1.
 */
export type ScanFactSource =
  | ScannerMatchSource
  | SchemaElementSource
  | McpResponseSource
  | LocalFileSource;

export type ScanFactSourceKind = ScanFactSource['kind'];

export interface ScanFact {
  readonly fact_id: string;
  readonly source: ScanFactSource;
  readonly file_path?: string;
  readonly line?: number;
  readonly observed_at: string;
  readonly args_fingerprint_sha256: string;
  readonly redacted: boolean;
}

/**
 * Stable reference to a `ScanFact` by id. Used in `Hypothesis.evidence_refs`
 * and `Finding.evidence_refs` so the report can join facts to inferences
 * and to assertions without re-embedding payloads.
 */
export interface ScanFactRef {
  readonly fact_id: ScanFact['fact_id'];
}

/**
 * Compile-time exhaustiveness helper for `ScanFactSource.kind` switches.
 * Adding a new variant to `ScanFactSource` fails the build until every
 * consumer extends its switch.
 */
export function assertExhaustiveScanFactSource(x: never): never {
  throw new Error(
    `Unhandled ScanFactSource: ${JSON.stringify(x)}`,
  );
}

/**
 * Compile-time exhaustiveness helper for `ScanFactContentKind` switches.
 */
export function assertExhaustiveScanFactContentKind(x: never): never {
  throw new Error(
    `Unhandled ScanFactContentKind: ${JSON.stringify(x)}`,
  );
}
