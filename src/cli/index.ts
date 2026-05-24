#!/usr/bin/env node

import { Command, CommanderError } from 'commander';

import { CliUsageError } from './errors.js';
import {
  buildScanCommand,
  defaultScanCommandDeps,
} from './scan-command.js';

const program = new Command();

program
  .name('veyra')
  .description(
    'Launch-readiness analyzer for AI-built SaaS apps (Lovable + Supabase first). Reports which controls were checked, which evidence was found, which was missing, and which issues appear launch-blocking. Phase 1 implements --mode read_only_evidence only.',
  )
  .version('0.0.0');

program.addCommand(buildScanCommand(defaultScanCommandDeps()));

// `pnpm dev -- scan ...` (documented in PHASE_1_PLAN §2 / step 03) forwards
// the literal `--` through tsx into process.argv, where commander would treat
// it as an end-of-options marker. Drop a single leading `--` so the
// documented invocation reaches the `scan` subcommand.
const rawArgv = process.argv.slice();
if (rawArgv[2] === '--') {
  rawArgv.splice(2, 1);
}

try {
  await program.parseAsync(rawArgv);
  process.exit(0);
} catch (e) {
  if (e instanceof CliUsageError) {
    process.stderr.write(`veyra: ${e.message}\n`);
    process.exit(2);
  }
  if (e instanceof CommanderError) {
    // commander has already printed its own message to stderr
    process.exit(e.exitCode === 0 ? 2 : e.exitCode);
  }
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`veyra: unexpected error: ${msg}\n`);
  process.exit(1);
}
