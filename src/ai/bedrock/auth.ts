import { type Result, err, ok } from '../../types/result.js';

/**
 * AWS auth (Bedrock; Phase 3 / Step 31b, `decisions.md` D4). Credentials are
 * read from the ENVIRONMENT ONLY — never from argv, never from an artifact,
 * never recorded in any trace (CLAUDE.md §Secrets). The Bedrock model id
 * (recorded in `loop-trace.jsonl`) is metadata, not a credential.
 *
 * The adapter does NOT build a SigV4 signature here; that is the AWS SDK's
 * concern. The `transport` is dependency-injected so tests use a
 * recorded-response fixture without involving the real SDK.
 */

export interface AwsCredentials {
  /** Access key id; ONLY checked for presence, never logged or returned to callers. */
  readonly hasAccessKeyId: boolean;
  /** Secret access key; ONLY checked for presence. */
  readonly hasSecretAccessKey: boolean;
  /** AWS region (non-secret, safe to record in audit). */
  readonly region: string;
}

export class MissingAwsCredentialsError extends Error {
  override readonly name = 'MissingAwsCredentialsError';
}

export type EnvReader = (name: string) => string | undefined;

/**
 * Read AWS credentials presence + region from the env. The actual key VALUES
 * never leave the process — only their PRESENCE crosses the boundary into the
 * provider. The provider then constructs a SigV4 client that reads the actual
 * values via the AWS SDK (also env-bound; never from argv).
 */
export function readAwsCredentials(
  env: EnvReader = (n) => process.env[n],
): Result<AwsCredentials, MissingAwsCredentialsError> {
  const hasAccessKeyId = (env('AWS_ACCESS_KEY_ID') ?? '').length > 0;
  const hasSecretAccessKey = (env('AWS_SECRET_ACCESS_KEY') ?? '').length > 0;
  const region = env('AWS_REGION') ?? env('AWS_DEFAULT_REGION') ?? '';
  if (!hasAccessKeyId || !hasSecretAccessKey) {
    return err(
      new MissingAwsCredentialsError(
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in the environment (Veyra never reads AWS creds from argv).',
      ),
    );
  }
  if (region.length === 0) {
    return err(
      new MissingAwsCredentialsError(
        'AWS_REGION (or AWS_DEFAULT_REGION) must be set in the environment.',
      ),
    );
  }
  return ok({ hasAccessKeyId, hasSecretAccessKey, region });
}
