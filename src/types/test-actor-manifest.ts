/**
 * Test-actor manifest types (step 2.06b).
 *
 * The Mode B sub-mode B.1 (default per step 2.01 decision 10): operator
 * pre-creates test users in their sandbox project and declares them in
 * a YAML manifest. Veyra reads the manifest, signs in as each actor
 * via `auth.signInWithPassword`, and runs catalog tests against the
 * resulting sessions.
 *
 * Key disciplines:
 *  - Passwords are NEVER inline. The manifest declares `password_env`
 *    field NAMES; the agent reads actual passwords from
 *    `process.env[<name>]` at runtime.
 *  - Role identifiers are opaque strings (no closed role-name union
 *    in shared types per FPP §2A).
 *  - Cleanup is a no-op: Veyra creates nothing in this sub-mode.
 */

/**
 * Opaque role identifier. The manifest's `roles` section enumerates
 * the role names the operator's app uses. The agent treats every
 * role name as opaque; the catalog tests interpret them through the
 * derived RoleModel (revision §3.3b).
 */
export type RoleId = string & { readonly __brand: 'TestActorRoleId' };

export function asRoleId(value: string): RoleId | undefined {
  if (value.length === 0) return undefined;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) return undefined;
  return value as RoleId;
}

export interface TestActorRoleRule {
  readonly can_access: readonly string[];
  readonly cannot_access: readonly string[];
}

export interface OwnedResource {
  readonly table: string;
  readonly id: string;
}

export interface TestActorEntry {
  readonly email: string;
  /** The NAME of the environment variable holding the password. */
  readonly password_env: string;
  readonly role: RoleId;
  readonly tenant_id?: string;
  readonly owns?: readonly OwnedResource[];
}

export interface TestActorManifest {
  readonly roles: Readonly<Record<string, TestActorRoleRule>>;
  readonly test_actors: readonly TestActorEntry[];
}

export interface TestActorManifestValidationError {
  readonly path: string;
  readonly message: string;
}

export class TestActorManifestParseError extends Error {
  override readonly name = 'TestActorManifestParseError';
  constructor(
    message: string,
    public readonly issues: readonly TestActorManifestValidationError[] = [],
  ) {
    super(message);
  }
}
