/**
 * Briefing prompt builder (Phase 3 / Step 40d). Builds the
 * `SanitizedMessage` user-message body for the briefing's pre-loop AI
 * call. The body is composed of deterministic inputs ONLY: inventory
 * digest, schema-table names if known, lockfile dependency surface,
 * and gitleaks/semgrep hit counts. Counts only — never excerpts (Step
 * 40d Guardrail §Secrets).
 *
 * The sole `SanitizedMessage` chokepoint is `redactSecrets(...)` in
 * `src/ai/sanitization.ts`. This module funnels every string body
 * through it before minting the brand.
 */

import { redactSecrets } from '../../ai/sanitization.js';
import type { InventoryBootstrap } from '../../agents/product-understanding/inventory/types.js';
import type { SanitizedMessage } from '../../types/sanitized-message.js';

/** Optional schema-meta enrichment surfaced from a prior tool's artifact. */
export interface BriefingSchemaMeta {
  readonly tables: readonly string[];
}

/** Optional lockfile dependency surface (Step 40d Decision H). */
export interface BriefingLockfileSummary {
  readonly key_deps: readonly string[];
}

/** Counts only — secrets never enter the prompt (CLAUDE.md §Secrets). */
export interface BriefingScannerCounts {
  readonly gitleaks_hits?: number;
  readonly semgrep_hits?: number;
}

export interface BuildBriefingPromptInput {
  readonly inventory: InventoryBootstrap;
  readonly schemaMeta?: BriefingSchemaMeta;
  readonly lockfile?: BriefingLockfileSummary;
  readonly scannerCounts?: BriefingScannerCounts;
}

export const BRIEFING_SYSTEM_PROMPT =
  'You are a project-briefing inference assistant. Given the deterministic inventory of a SaaS project, infer a short briefing that describes: ' +
  'what the product is (purpose), the user roles it appears to have, the kinds of data it handles, the auth model in use, candidate sensitive tables (names only), ' +
  'the dependency surface (framework + key library names), and the observed trust boundaries. ' +
  'Output JSON that strictly matches the response schema. Use confidence levels low/medium/high and include uncertainty_notes when the inference is shaky. ' +
  'You are describing observed metadata, NOT making security verdicts. Never use the words "secure", "safe", "compliant", "vulnerable", "exploit", or "launch-blocker" anywhere in any field. ' +
  'Never use the tokens "finding_type", "review_action", "evidence_strength", "blast_radius", "reproducibility", "fix_before_launch", "review_before_launch", "confirmed_issue", "likely_issue", or "coverage_gap" anywhere in any field.';

/** Build the sanitized system prompt for the AI briefing call. */
export function buildBriefingSystemPrompt(): SanitizedMessage {
  return redactSecrets(BRIEFING_SYSTEM_PROMPT);
}

/** Build the sanitized user-message body for the AI briefing call. */
export function buildBriefingUserPrompt(
  input: BuildBriefingPromptInput,
): SanitizedMessage {
  const lines: string[] = [];
  const ev = input.inventory.observed_evidence;

  lines.push('Project inventory:');
  if (ev.package_json_digest !== undefined) {
    lines.push(`- name: ${ev.package_json_digest.name}`);
    if (ev.package_json_digest.dependencies !== undefined) {
      const depNames = Object.keys(ev.package_json_digest.dependencies).join(', ');
      lines.push(`- dependencies: ${depNames}`);
    }
  }
  lines.push(`- framework: ${ev.framework}`);
  if (ev.routes.length > 0) {
    lines.push(`- routes: ${ev.routes.join(', ')}`);
  }
  if (ev.env_declarations.length > 0) {
    lines.push(`- env vars referenced: ${ev.env_declarations.join(', ')}`);
  }
  if (ev.supabase_schema !== undefined && ev.supabase_schema.tables.length > 0) {
    lines.push(`- supabase tables (inventory): ${ev.supabase_schema.tables.join(', ')}`);
  }

  if (input.schemaMeta !== undefined && input.schemaMeta.tables.length > 0) {
    lines.push(`- supabase tables (schema metadata): ${input.schemaMeta.tables.join(', ')}`);
  }

  if (input.lockfile !== undefined && input.lockfile.key_deps.length > 0) {
    lines.push(`- key lockfile deps: ${input.lockfile.key_deps.join(', ')}`);
  }

  if (input.scannerCounts !== undefined) {
    if (input.scannerCounts.gitleaks_hits !== undefined) {
      lines.push(`- gitleaks hits (count): ${String(input.scannerCounts.gitleaks_hits)}`);
    }
    if (input.scannerCounts.semgrep_hits !== undefined) {
      lines.push(`- semgrep hits (count): ${String(input.scannerCounts.semgrep_hits)}`);
    }
  }

  lines.push('');
  lines.push(
    'Produce the project-briefing JSON object now. Names of tables / dependencies / roles must be observational tokens only.',
  );

  return redactSecrets(lines.join('\n'));
}
