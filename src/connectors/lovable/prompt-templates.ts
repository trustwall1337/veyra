/**
 * The four allowed `send_message` templates for the Lovable MCP
 * connector. Per PHASE_1_PLAN §3 Step 1 and CLAUDE.md §MCP discipline:
 * the connector accepts a `PromptTemplateId` only, never free-form
 * text. Adding a new template = code change + mcp-policy-check review.
 */

import { asPromptTemplateId, type PromptTemplateId } from '../../types/prompt-template.js';

function mintId(value: string): PromptTemplateId {
  const r = asPromptTemplateId(value);
  if (!r.ok) {
    throw new Error(
      `lovable prompt-templates: invalid hardcoded id "${value}": ${r.error.message}`,
    );
  }
  return r.value;
}

export const TEMPLATE_PROJECT_OVERVIEW: PromptTemplateId = mintId(
  'templates.project_overview',
);
export const TEMPLATE_USER_FLOWS: PromptTemplateId = mintId(
  'templates.user_flows',
);
export const TEMPLATE_DATA_HANDLING: PromptTemplateId = mintId(
  'templates.data_handling',
);
export const TEMPLATE_AUTH_MODEL: PromptTemplateId = mintId(
  'templates.auth_model',
);

interface TemplateEntry {
  readonly id: PromptTemplateId;
  readonly canonical_text: string;
}

const TEMPLATES: ReadonlyMap<string, TemplateEntry> = new Map<string, TemplateEntry>([
  [
    TEMPLATE_PROJECT_OVERVIEW,
    {
      id: TEMPLATE_PROJECT_OVERVIEW,
      canonical_text:
        'What does this project do at a high level?',
    },
  ],
  [
    TEMPLATE_USER_FLOWS,
    {
      id: TEMPLATE_USER_FLOWS,
      canonical_text:
        'What are the primary user-facing flows in this project?',
    },
  ],
  [
    TEMPLATE_DATA_HANDLING,
    {
      id: TEMPLATE_DATA_HANDLING,
      canonical_text:
        'What kinds of data does this project store or process?',
    },
  ],
  [
    TEMPLATE_AUTH_MODEL,
    {
      id: TEMPLATE_AUTH_MODEL,
      canonical_text:
        'What authentication and authorization model does this project use?',
    },
  ],
]);

export function isAllowedTemplate(id: string): id is string {
  return TEMPLATES.has(id);
}

export function canonicalTextFor(id: PromptTemplateId): string | undefined {
  return TEMPLATES.get(id)?.canonical_text;
}

export function listAllowedTemplates(): readonly PromptTemplateId[] {
  return Array.from(TEMPLATES.values()).map((e) => e.id);
}
