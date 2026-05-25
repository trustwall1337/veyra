import { describe, expect, it } from 'vitest';

import {
  assertExhaustiveContextRequestKind,
  type ContextRequest,
  type ContextRequestKind,
} from './context-request.js';
import { asPromptTemplateId } from './prompt-template.js';
import { isErr } from './result.js';

function describeKind(req: ContextRequest): string {
  switch (req.kind) {
    case 'read_file':
      return 'read_file';
    case 'list_files':
      return 'list_files';
    case 'get_supabase_table_meta':
      return 'get_supabase_table_meta';
    case 'get_supabase_advisors':
      return 'get_supabase_advisors';
    case 'send_message_template':
      return 'send_message_template';
    default:
      return assertExhaustiveContextRequestKind(req);
  }
}

describe('ContextRequest exhaustiveness', () => {
  it('every kind has a handler', () => {
    const templateId = asPromptTemplateId('templates.project_overview');
    if (isErr(templateId)) throw new Error('id');

    const samples: ContextRequest[] = [
      {
        request_id: 'r1',
        for_hypothesis_id: 'h1',
        justification: 'need to inspect a route file',
        kind: 'read_file',
        args: { kind: 'read_file', path: 'src/App.tsx' },
      },
      {
        request_id: 'r2',
        for_hypothesis_id: 'h1',
        justification: 'enumerate routes',
        kind: 'list_files',
        args: { kind: 'list_files', scope: 'src/pages' },
      },
      {
        request_id: 'r3',
        for_hypothesis_id: 'h2',
        justification: 'check table existence',
        kind: 'get_supabase_table_meta',
        args: { kind: 'get_supabase_table_meta', table_names: ['users'] },
      },
      {
        request_id: 'r4',
        for_hypothesis_id: 'h2',
        justification: 'pull advisor warnings',
        kind: 'get_supabase_advisors',
        args: { kind: 'get_supabase_advisors' },
      },
      {
        request_id: 'r5',
        for_hypothesis_id: 'h3',
        justification: 'ask the project for its declared intent',
        kind: 'send_message_template',
        args: {
          kind: 'send_message_template',
          template_id: templateId.value,
        },
      },
    ];

    for (const r of samples) {
      expect(describeKind(r)).toBe(r.kind);
    }
  });

  it('top-level kind is constrained to the five known values', () => {
    // @ts-expect-error — ContextRequest does not accept arbitrary kinds
    const _bad: ContextRequestKind = 'execute_sql';
    void _bad;
  });
});
