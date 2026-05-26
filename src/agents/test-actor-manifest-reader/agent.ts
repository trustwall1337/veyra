/**
 * Test-actor manifest reader agent (step 2.06b).
 *
 * Mode B sub-mode B.1 — the default-documented Mode B path per step
 * 2.01 decision 10. Reads a YAML manifest pointed at by
 * `--test-actor-manifest`, validates the schema, signs in as each
 * declared actor via `auth.signInWithPassword`, holds JWTs in memory,
 * produces `synthetic-resources.json` shaped identically to step
 * 2.06's output (so the sandbox-runner is sub-mode-agnostic).
 *
 * Mutation discipline (PHASE_2_PLAN §1.1 Mode B sub-mode B.1):
 *  - This agent does NOT hold the service-role key. No
 *    `auth.admin.*` calls. No mutation. No cleanup needed.
 *  - Passwords flow only through `process.env[<name>]`. The manifest
 *    declares the env-var NAME (`password_env`); raw passwords are
 *    rejected at parse time.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type { Finding } from '../../types/finding.js';
import type { ConnectorId } from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';
import type { TestIdentity } from '../../types/active-validation.js';
import {
  TestActorManifestParseError,
  asRoleId,
  type RoleId,
  type TestActorEntry,
  type TestActorManifest,
  type TestActorManifestValidationError,
} from '../../types/test-actor-manifest.js';

export const TEST_ACTOR_MANIFEST_AGENT_ID = 'test-actor-manifest-reader';
export const SYNTHETIC_RESOURCES_ARTIFACT = 'synthetic-resources.json';
export const ROLE_MODEL_ARTIFACT = 'role-model.json';
export const MANIFEST_VALIDATION_ARTIFACT = 'manifest-validation.json';

const METADATA: AgentMetadata = {
  id: TEST_ACTOR_MANIFEST_AGENT_ID,
  version: '0.1.0',
  declared_dependencies: [],
  produces: [
    SYNTHETIC_RESOURCES_ARTIFACT,
    ROLE_MODEL_ARTIFACT,
    MANIFEST_VALIDATION_ARTIFACT,
  ],
};

/**
 * Narrow auth-signin surface. Tests inject a fake; production callers
 * use Supabase's `auth.signInWithPassword` (no service-role key
 * needed — anon key is sufficient).
 */
export interface AuthSignInClient {
  readonly id: ConnectorId;
  signInWithPassword(params: {
    readonly email: string;
    readonly password: string;
  }): Promise<
    Result<
      {
        readonly access_token: string;
        readonly user: { readonly id: string };
      },
      Error
    >
  >;
}

export interface TestActorManifestReaderInput {
  /** Absolute path to the YAML manifest. */
  readonly manifestPath: string;
  readonly authClient: AuthSignInClient;
  readonly envReader: (name: string) => string | undefined;
}

export interface TestActorManifestReaderOutput {
  readonly identities: readonly TestIdentity[];
  /**
   * Per-actor JWT held in memory only — never written to any
   * artifact. The sandbox-runner reads this from the in-process
   * agent result, not from disk.
   */
  readonly sessions: readonly {
    readonly test_id: string;
    readonly access_token: string;
  }[];
}

export function createTestActorManifestReaderAgent(): VeyraAgent<
  TestActorManifestReaderInput,
  TestActorManifestReaderOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: TestActorManifestReaderInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<TestActorManifestReaderOutput>> {
      // Read + parse YAML.
      let text: string;
      try {
        text = await fs.readFile(input.manifestPath, 'utf8');
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        return failureResult(
          context,
          `manifest file could not be read at ${input.manifestPath}: ${m}`,
        );
      }
      const parsedR = parseManifest(text);
      if (!parsedR.ok) {
        return failureResult(
          context,
          `manifest validation failed: ${parsedR.error.message}`,
          parsedR.error.issues,
        );
      }
      const manifest = parsedR.value;

      // Sign in as each declared actor.
      const identities: TestIdentity[] = [];
      const sessions: { test_id: string; access_token: string }[] = [];
      const warnings: string[] = [];
      for (const actor of manifest.test_actors) {
        const password = input.envReader(actor.password_env);
        if (password === undefined || password.length === 0) {
          return failureResult(
            context,
            `password env var ${actor.password_env} for actor ${actor.email} is unset`,
          );
        }
        const sr = await input.authClient.signInWithPassword({
          email: actor.email,
          password,
        });
        if (!sr.ok) {
          return failureResult(
            context,
            `sign-in failed for ${actor.email}: ${sr.error.message}`,
          );
        }
        identities.push({
          id: actor.email,
          scan_id: context.scanId,
          provider_subject_id: sr.value.user.id,
          identity_provider_id: input.authClient.id,
          role: actor.role,
          ...(actor.tenant_id !== undefined ? { tenant_id: actor.tenant_id } : {}),
          created_at: new Date().toISOString(),
        });
        sessions.push({
          test_id: actor.email,
          access_token: sr.value.access_token,
        });
      }

      // Persist artifacts. NOTE: synthetic-resources.json + role-model.json
      // do NOT contain JWTs (sessions stay in memory only).
      const artifacts: ArtifactRef[] = [];
      await fs.mkdir(context.artifactDir, { recursive: true });
      const resourcesPath = path.join(
        context.artifactDir,
        SYNTHETIC_RESOURCES_ARTIFACT,
      );
      await fs.writeFile(
        resourcesPath,
        JSON.stringify(
          {
            scan_id: context.scanId,
            sub_mode: 'manifest',
            identities: identities.map((i) => ({
              test_id: i.id,
              provider_subject_id: i.provider_subject_id,
              role: i.role,
              ...(i.tenant_id !== undefined ? { tenant_id: i.tenant_id } : {}),
            })),
          },
          null,
          2,
        ),
        'utf8',
      );
      artifacts.push({
        scanId: context.scanId,
        kind: 'evidence_inventory',
        path: resourcesPath,
      });

      const roleModelPath = path.join(context.artifactDir, ROLE_MODEL_ARTIFACT);
      const roleModel = {
        confidence: 'declared' as const,
        roles: Object.entries(manifest.roles).map(([name, rule]) => ({
          role: name,
          can_access: rule.can_access,
          cannot_access: rule.cannot_access,
        })),
      };
      await fs.writeFile(roleModelPath, JSON.stringify(roleModel, null, 2), 'utf8');
      artifacts.push({
        scanId: context.scanId,
        kind: 'evidence_inventory',
        path: roleModelPath,
      });

      return {
        status: 'completed',
        artifacts,
        findings: [],
        warnings,
        output: { identities, sessions },
      };
    },
  };
}

function failureResult(
  context: AgentExecutionContext,
  message: string,
  issues: readonly TestActorManifestValidationError[] = [],
): AgentResult<TestActorManifestReaderOutput> {
  context.logger.error(`test-actor-manifest-reader: ${message}`);
  const summary =
    issues.length > 0
      ? `${message} — ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`
      : message;
  return {
    status: 'failed',
    artifacts: [],
    findings: [
      {
        id: 'cc-2-06b-manifest-failed',
        control_id: 'cc-2-06b',
        finding_type: 'coverage_gap',
        evidence_strength: 'low',
        reproducibility: 'manual_review_required',
        review_action: 'review_before_launch',
        blast_radius: 'unknown',
        title: 'Test-actor manifest could not be loaded',
        summary: `${summary}. Active validation cannot proceed; needs human review.`,
        evidence_refs: [],
      },
    ],
    warnings: [message],
  };
}

export function parseManifest(
  yaml: string,
): Result<TestActorManifest, TestActorManifestParseError> {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new TestActorManifestParseError(`YAML parse failed: ${m}`));
  }
  if (typeof raw !== 'object' || raw === null) {
    return err(new TestActorManifestParseError('manifest root must be a YAML mapping'));
  }
  const root = raw as Record<string, unknown>;
  const issues: TestActorManifestValidationError[] = [];

  const rolesRaw = root['roles'];
  const roles: Record<string, { can_access: string[]; cannot_access: string[] }> = {};
  if (typeof rolesRaw !== 'object' || rolesRaw === null || Array.isArray(rolesRaw)) {
    issues.push({ path: '/roles', message: 'must be a YAML mapping' });
  } else {
    for (const [name, value] of Object.entries(rolesRaw as Record<string, unknown>)) {
      const branded = asRoleId(name);
      if (branded === undefined) {
        issues.push({ path: `/roles/${name}`, message: 'invalid role identifier' });
        continue;
      }
      if (typeof value !== 'object' || value === null) {
        issues.push({ path: `/roles/${name}`, message: 'must be a YAML mapping' });
        continue;
      }
      const v = value as Record<string, unknown>;
      const canAccess = Array.isArray(v['can_access']) ? (v['can_access'] as unknown[]) : [];
      const cannotAccess = Array.isArray(v['cannot_access']) ? (v['cannot_access'] as unknown[]) : [];
      roles[branded] = {
        can_access: canAccess.filter((x): x is string => typeof x === 'string'),
        cannot_access: cannotAccess.filter((x): x is string => typeof x === 'string'),
      };
    }
  }

  const actorsRaw = root['test_actors'];
  const actors: TestActorEntry[] = [];
  if (!Array.isArray(actorsRaw)) {
    issues.push({ path: '/test_actors', message: 'must be a YAML sequence' });
  } else {
    for (let i = 0; i < actorsRaw.length; i++) {
      const a = actorsRaw[i];
      if (typeof a !== 'object' || a === null) {
        issues.push({ path: `/test_actors[${i}]`, message: 'must be a mapping' });
        continue;
      }
      const ar = a as Record<string, unknown>;
      if ('password' in ar) {
        issues.push({
          path: `/test_actors[${i}]/password`,
          message: 'inline password is forbidden — declare `password_env: <NAME>` and set the env var',
        });
        continue;
      }
      const email = typeof ar['email'] === 'string' ? ar['email'] : undefined;
      const passwordEnv = typeof ar['password_env'] === 'string' ? ar['password_env'] : undefined;
      const roleStr = typeof ar['role'] === 'string' ? ar['role'] : undefined;
      if (email === undefined) {
        issues.push({ path: `/test_actors[${i}]/email`, message: 'required string' });
        continue;
      }
      if (passwordEnv === undefined) {
        issues.push({ path: `/test_actors[${i}]/password_env`, message: 'required string' });
        continue;
      }
      if (roleStr === undefined || asRoleId(roleStr) === undefined) {
        issues.push({ path: `/test_actors[${i}]/role`, message: 'required role identifier' });
        continue;
      }
      const role = asRoleId(roleStr) as RoleId;
      if (!(roleStr in roles)) {
        issues.push({
          path: `/test_actors[${i}]/role`,
          message: `role "${roleStr}" is not declared in /roles`,
        });
        continue;
      }
      const entry: { -readonly [K in keyof TestActorEntry]: TestActorEntry[K] } = {
        email,
        password_env: passwordEnv,
        role,
      };
      if (typeof ar['tenant_id'] === 'string') entry.tenant_id = ar['tenant_id'];
      if (Array.isArray(ar['owns'])) {
        const owns: { table: string; id: string }[] = [];
        for (const o of ar['owns'] as unknown[]) {
          if (typeof o === 'object' && o !== null) {
            const oo = o as Record<string, unknown>;
            if (typeof oo['table'] === 'string' && typeof oo['id'] === 'string') {
              owns.push({ table: oo['table'], id: oo['id'] });
            }
          }
        }
        entry.owns = owns;
      }
      actors.push(entry);
    }
  }

  if (issues.length > 0) {
    return err(
      new TestActorManifestParseError(
        `${String(issues.length)} validation issue(s)`,
        issues,
      ),
    );
  }
  return ok({ roles, test_actors: actors });
}
