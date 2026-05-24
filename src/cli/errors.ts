/**
 * Argv-level usage errors raised by the CLI before any scan work begins.
 *
 * These map to exit code 2 in `src/cli/index.ts`. Reserve `Error` (and other
 * subclasses) for unexpected failures — see `CLAUDE.md §TypeScript conventions`.
 */
export class CliUsageError extends Error {
  override readonly name = 'CliUsageError';
}
