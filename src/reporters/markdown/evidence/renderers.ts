/**
 * Per-`EvidenceKind` renderers. One function per discriminator value.
 * The dispatch in `renderEvidenceItem` is exhaustive — adding a new
 * `EvidenceKind` without an accompanying renderer fails the build via
 * `assertExhaustive`.
 */

import { redactSecrets } from '../../../ai/sanitization.js';
import { assertExhaustive, type EvidenceItem } from '../../../types/evidence.js';
import { STRINGS } from '../strings.js';

export function renderStaticCode(
  e: Extract<EvidenceItem, { source: 'static_code' }>,
): string {
  const where =
    e.line !== undefined ? `${e.file}:${String(e.line)}` : e.file;
  // Per step 13 Guardrails: secret-like patterns in code snippets
  // must be redacted before persisting to the report. The reporter
  // runs the 02c sanitizer on every excerpt, even though upstream
  // agents typically already sanitize.
  const safeExcerpt =
    e.excerpt !== undefined ? (redactSecrets(e.excerpt) as string) : undefined;
  const tail = safeExcerpt !== undefined ? `\n\`\`\`\n${safeExcerpt}\n\`\`\`` : '';
  return `- static-code: \`${where}\`${tail}`;
}

export function renderMcpContext(
  e: Extract<EvidenceItem, { source: 'mcp_context' }>,
): string {
  return `- mcp-context: server=\`${e.server as string}\`, tool=\`${e.tool}\`, request_fingerprint=\`${e.request_fingerprint}\` ${STRINGS.MCP_DECLARED_NOT_VERIFIED}`;
}

export function renderScanner(
  e: Extract<EvidenceItem, { source: 'scanner' }>,
): string {
  // Per step 13: scanner evidence renders a reference to the scanner
  // findings artifact. The artifact for tool-runner output is
  // `scan-facts.json` post-08b. We point at it by name rather than
  // by path because the reporter is pure (no filesystem reads).
  return `- scanner: \`${e.scanner as string}\`, finding_id=\`${e.finding_id}\` (see \`scan-facts.json\` for the full ScanFact)`;
}

export function renderActiveValidation(
  e: Extract<EvidenceItem, { source: 'active_validation' }>,
): string {
  return `- active-validation: test_id=\`${e.test_id}\`, outcome=\`${e.outcome}\` (${STRINGS.ACTIVE_VALIDATION_NOT_RUN})`;
}

export function renderCleanupProof(
  e: Extract<EvidenceItem, { source: 'cleanup_proof' }>,
): string {
  return `- cleanup-proof: scan_id=\`${e.scan_id}\`, residual_count=${String(e.residual_count)} (${STRINGS.CLEANUP_PROOF_NOT_RUN})`;
}

export function renderEvidenceItem(e: EvidenceItem): string {
  switch (e.source) {
    case 'static_code':
      return renderStaticCode(e);
    case 'mcp_context':
      return renderMcpContext(e);
    case 'scanner':
      return renderScanner(e);
    case 'active_validation':
      return renderActiveValidation(e);
    case 'cleanup_proof':
      return renderCleanupProof(e);
    default:
      return assertExhaustive(e);
  }
}
