#!/usr/bin/env node
// Pre-write secret scanner. Backstops the Veyra redaction rule
// (CLAUDE.md §Secrets) by blocking Write/Edit calls that embed raw secret
// values. Reads tool input on stdin as JSON; exits 2 with a stderr message
// to block.

import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const tool = input.tool_name ?? '';
const params = input.tool_input ?? {};

let content = '';
if (tool === 'Write') content = String(params.content ?? '');
else if (tool === 'Edit') content = String(params.new_string ?? '');
else process.exit(0);

// Skip the intentionally vulnerable fixture project — secret-like strings
// there are test data the scanner is supposed to find.
const filePath = String(params.file_path ?? '');
if (filePath.includes('/examples/')) process.exit(0);

const patterns = [
  { name: 'JWT (Supabase/generic)', re: /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe key', re: /\bsk_(live|test)_[A-Za-z0-9]{20,}/ },
  { name: 'sk- API key (OpenAI/Anthropic-style)', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub PAT', re: /\b(ghp_|github_pat_)[A-Za-z0-9_]{20,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abp]-[A-Za-z0-9-]{10,}/ },
];

const hits = patterns.filter((p) => p.re.test(content));
if (hits.length === 0) process.exit(0);

const types = hits.map((h) => h.name).join(', ');
process.stderr.write(
  `Blocked ${tool} on ${filePath || '(unknown path)'}: proposed content matches a raw-secret ` +
    `pattern (${types}). Veyra's redaction rule (CLAUDE.md §Secrets) forbids storing, logging, ` +
    `or reporting raw secret values. Replace with a redacted placeholder, build the string at ` +
    `runtime, or move the fixture under examples/ if this is intentional test data.\n`,
);
process.exit(2);
