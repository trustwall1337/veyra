import { type Result, err, ok } from '../../types/result.js';

/**
 * AWS auth (Bedrock; Phase 3 / Step 31d, `decisions.md` D4). Credentials are
 * resolved by the AWS SDK default provider chain (env, `AWS_PROFILE`, SSO,
 * web identity, EC2 / ECS instance metadata) — never read here directly,
 * never returned to callers, never logged (CLAUDE.md §Secrets).
 *
 * The chain is loaded LAZILY via dynamic `await import(...)` so a `--no-ai`
 * scan or a recorded-fixture test path never pulls the AWS SDK into the
 * process. Step 31d V8 enforces this.
 *
 * `readAwsCredentials()` reports presence + region + the chain source
 * discriminator (the NAME of the source — `'profile'` etc., never the value).
 * The actual credential VALUES live in the SDK; `liveBedrockTransport`
 * constructs the client with the same chain so it picks the same set up.
 */

/** Identifier for which credential source the SDK chain resolved from. */
export type AwsCredentialSource =
  | 'static-env'
  | 'profile'
  | 'web-identity'
  | 'sso'
  | 'imds'
  | 'container'
  | 'process'
  | 'unknown';

export interface AwsCredentials {
  /** Whether the SDK chain resolved a credential at all. */
  readonly resolved: true;
  /** AWS region (non-secret, safe to record in audit). */
  readonly region: string;
  /** Discriminator naming the source the chain resolved from. */
  readonly source: AwsCredentialSource;
}

export class MissingAwsCredentialsError extends Error {
  override readonly name = 'MissingAwsCredentialsError';
}

export type EnvReader = (name: string) => string | undefined;

const SDK_PROVIDER_NAMES_TO_SOURCE: ReadonlyArray<[RegExp, AwsCredentialSource]> = [
  [/EnvProvider|fromEnv/i, 'static-env'],
  [/IniProvider|SharedIni|fromIni|Profile/i, 'profile'],
  [/SsoProvider|fromSSO|SSO/i, 'sso'],
  [/WebIdentity/i, 'web-identity'],
  [/ContainerProvider|ECS|container/i, 'container'],
  [/InstanceMetadata|imds|ec2/i, 'imds'],
  [/Process/i, 'process'],
];

function classifyProviderName(name: string | undefined): AwsCredentialSource {
  if (name === undefined || name.length === 0) return 'unknown';
  for (const [re, source] of SDK_PROVIDER_NAMES_TO_SOURCE) {
    if (re.test(name)) return source;
  }
  return 'unknown';
}

export interface ReadAwsCredentialsOptions {
  /** Env reader (test injection). Defaults to `process.env[name]`. */
  readonly env?: EnvReader;
  /**
   * Override the chain loader for tests. Returns a credential identity OR
   * throws. Production callers leave undefined; the real
   * `@aws-sdk/credential-providers#fromNodeProviderChain()` is loaded lazily.
   */
  readonly chainLoader?: () => Promise<{
    readonly providerName?: string;
  }>;
}

/**
 * Resolve AWS credentials via the SDK chain; report presence + region +
 * source discriminator. Never returns or logs a key value.
 */
export async function readAwsCredentials(
  opts: ReadAwsCredentialsOptions = {},
): Promise<Result<AwsCredentials, MissingAwsCredentialsError>> {
  const env: EnvReader = opts.env ?? ((n) => process.env[n]);
  const region = env('AWS_REGION') ?? env('AWS_DEFAULT_REGION') ?? '';
  if (region.length === 0) {
    return err(
      new MissingAwsCredentialsError(
        'AWS_REGION (or AWS_DEFAULT_REGION) must be set in the environment.',
      ),
    );
  }

  let resolvedIdentity: { providerName?: string } | undefined;
  try {
    if (opts.chainLoader !== undefined) {
      resolvedIdentity = await opts.chainLoader();
    } else {
      // Lazy import — keeps the SDK out of `--no-ai` and recorded-fixture
      // test paths (V8). Resolution is "does the chain produce a credential
      // at all"; the credential value never crosses this boundary.
      const mod = await import('@aws-sdk/credential-providers');
      const provider = mod.fromNodeProviderChain();
      // `$source` is a runtime extension some SDK providers attach for
      // observability; not part of the typed `AwsCredentialIdentity` shape,
      // so probe defensively.
      const identity = (await provider()) as unknown as
        | Record<string, unknown>
        | undefined;
      const sourceMap =
        identity !== undefined &&
        '$source' in identity &&
        typeof identity['$source'] === 'object' &&
        identity['$source'] !== null
          ? (identity['$source'] as Record<string, unknown>)
          : undefined;
      resolvedIdentity =
        sourceMap !== undefined
          ? { providerName: Object.keys(sourceMap).join(',') }
          : {};
    }
  } catch (cause) {
    return err(
      new MissingAwsCredentialsError(
        `AWS credential chain did not resolve (the SDK consults env AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN, AWS_PROFILE, SSO, web identity, ECS/EC2 metadata): ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }

  return ok({
    resolved: true,
    region,
    source: classifyProviderName(resolvedIdentity?.providerName),
  });
}
