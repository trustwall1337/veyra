import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthSignInClient } from './agent.js';
import {
  ROLE_MODEL_ARTIFACT,
  SYNTHETIC_RESOURCES_ARTIFACT,
  createTestActorManifestReaderAgent,
  parseManifest,
} from './agent.js';
import { asConnectorId } from '../../types/identity.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';
import { err, ok } from '../../types/result.js';

const VALID_YAML = `
roles:
  admin:
    can_access: [/admin/*, all_invoices]
    cannot_access: []
  member:
    can_access: [own_invoices]
    cannot_access: [cross_tenant_invoices]

test_actors:
  - email: admin@test.local
    password_env: TEST_ADMIN_PW
    role: admin
    tenant_id: t1
  - email: alice@test.local
    password_env: TEST_ALICE_PW
    role: member
    tenant_id: t1
    owns:
      - { table: invoices, id: inv-A-1 }
`;

const INLINE_PASSWORD_YAML = `
roles: { member: { can_access: [], cannot_access: [] } }
test_actors:
  - email: bob@test.local
    password: hunter2-not-allowed
    role: member
`;

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-tam-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function connectorId(s: string) {
  const r = asConnectorId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function fakeAuth(succeed = true): AuthSignInClient {
  let nextId = 0;
  return {
    id: connectorId('supabase-auth'),
    async signInWithPassword({ email }) {
      if (!succeed) return err(new Error('forced sign-in failure'));
      return ok({
        access_token: `jwt-for-${email}`,
        user: { id: `user-uid-${String(nextId++)}` },
      });
    },
  };
}

function fakeContext() {
  return {
    scanId: 'tam-scan-1',
    projectRoot: workdir,
    artifactDir: workdir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

describe('test-actor-manifest schema validation', () => {
  it('accepts a well-formed manifest', () => {
    const r = parseManifest(VALID_YAML);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.test_actors).toHaveLength(2);
      expect(Object.keys(r.value.roles)).toEqual(['admin', 'member']);
    }
  });

  it('rejects inline `password:` field (must use password_env)', () => {
    const r = parseManifest(INLINE_PASSWORD_YAML);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.issues.some((i) => i.message.includes('inline password is forbidden'))).toBe(
        true,
      );
    }
  });

  it('rejects unknown role names referenced by an actor', () => {
    const bad = `
roles:
  admin: { can_access: [], cannot_access: [] }
test_actors:
  - email: x@y.com
    password_env: P
    role: ghost
`;
    const r = parseManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.issues.some((i) => i.message.includes('not declared'))).toBe(true);
    }
  });

  it('rejects malformed YAML at the parser boundary', () => {
    const r = parseManifest('this: is\n  : broken\n   - yaml');
    expect(r.ok).toBe(false);
  });
});

describe('test-actor-manifest-reader agent — happy path', () => {
  it('signs in each actor, writes synthetic-resources.json + role-model.json', async () => {
    const manifestPath = path.join(workdir, 'test-actors.yaml');
    await writeFile(manifestPath, VALID_YAML, 'utf8');

    const env = new Map<string, string>([
      ['TEST_ADMIN_PW', 'admin-pw'],
      ['TEST_ALICE_PW', 'alice-pw'],
    ]);
    const agent = createTestActorManifestReaderAgent();
    const result = await agent.run(
      {
        manifestPath,
        authClient: fakeAuth(),
        envReader: (n) => env.get(n),
      },
      fakeContext(),
    );

    expect(result.status).toBe('completed');
    expect(result.output?.identities).toHaveLength(2);
    expect(result.output?.sessions).toHaveLength(2);
    // JWT held in memory, NOT in artifacts.
    const resourcesText = await readFile(
      path.join(workdir, SYNTHETIC_RESOURCES_ARTIFACT),
      'utf8',
    );
    expect(resourcesText).not.toContain('jwt-for-');

    const roleModelText = await readFile(
      path.join(workdir, ROLE_MODEL_ARTIFACT),
      'utf8',
    );
    const rm = JSON.parse(roleModelText) as {
      confidence: string;
      source: string;
      roles: { role_id: string }[];
      tenancy: { scoped_resources: string[]; tenant_ownership: Record<string, unknown> };
    };
    expect(rm.confidence).toBe('declared');
    expect(rm.source).toBe('test-actor-manifest');
    // Roles use role_id (opaque RoleId string), not 'role'.
    expect(rm.roles[0]?.role_id.length).toBeGreaterThan(0);
    expect(rm.tenancy.scoped_resources).toContain('invoices');
  });

  it('writes cleanup-proof.json with session_discard + zero-residual (codex retro 2.06b-missing-cleanup-proof)', async () => {
    const { CLEANUP_PROOF_ARTIFACT } = await import('./agent.js');
    const manifestPath = path.join(workdir, 'test-actors.yaml');
    await writeFile(manifestPath, VALID_YAML, 'utf8');
    const env = new Map<string, string>([
      ['TEST_ADMIN_PW', 'admin-pw'],
      ['TEST_ALICE_PW', 'alice-pw'],
    ]);
    const agent = createTestActorManifestReaderAgent();
    await agent.run(
      {
        manifestPath,
        authClient: fakeAuth(),
        envReader: (n) => env.get(n),
      },
      fakeContext(),
    );
    const text = await readFile(path.join(workdir, CLEANUP_PROOF_ARTIFACT), 'utf8');
    const proof = JSON.parse(text) as Record<string, unknown>;
    expect(proof['sub_mode']).toBe('manifest');
    expect(proof['created_count']).toBe(0);
    expect(proof['residual_count']).toBe(0);
    expect(proof['session_discard']).toBe(true);
  });

  it('synthetic-resources.json shape matches B.2 (codex retro 2.06b-resource-artifact-shape-drift)', async () => {
    const manifestPath = path.join(workdir, 'test-actors.yaml');
    await writeFile(manifestPath, VALID_YAML, 'utf8');
    const env = new Map<string, string>([
      ['TEST_ADMIN_PW', 'admin-pw'],
      ['TEST_ALICE_PW', 'alice-pw'],
    ]);
    const agent = createTestActorManifestReaderAgent();
    await agent.run(
      {
        manifestPath,
        authClient: fakeAuth(),
        envReader: (n) => env.get(n),
      },
      fakeContext(),
    );
    const text = await readFile(
      path.join(workdir, SYNTHETIC_RESOURCES_ARTIFACT),
      'utf8',
    );
    const r = JSON.parse(text) as {
      identities: { uid: string; test_id: string }[];
    };
    // Same shape as src/agents/synthetic-data-manager/agent.ts emits:
    // { uid, test_id } per identity.
    for (const id of r.identities) {
      expect(typeof id.uid).toBe('string');
      expect(typeof id.test_id).toBe('string');
    }
  });
});

describe('test-actor-manifest-reader agent — failure paths', () => {
  it('refuses when password env var is unset', async () => {
    const manifestPath = path.join(workdir, 'test-actors.yaml');
    await writeFile(manifestPath, VALID_YAML, 'utf8');

    const agent = createTestActorManifestReaderAgent();
    const result = await agent.run(
      {
        manifestPath,
        authClient: fakeAuth(),
        envReader: () => undefined,
      },
      fakeContext(),
    );
    expect(result.status).toBe('failed');
    expect(result.findings[0]?.summary).toContain('TEST_ADMIN_PW');
  });

  it('surfaces sign-in failure as agent failed status', async () => {
    const manifestPath = path.join(workdir, 'test-actors.yaml');
    await writeFile(manifestPath, VALID_YAML, 'utf8');

    const env = new Map<string, string>([
      ['TEST_ADMIN_PW', 'admin-pw'],
      ['TEST_ALICE_PW', 'alice-pw'],
    ]);
    const agent = createTestActorManifestReaderAgent();
    const result = await agent.run(
      {
        manifestPath,
        authClient: fakeAuth(false),
        envReader: (n) => env.get(n),
      },
      fakeContext(),
    );
    expect(result.status).toBe('failed');
    expect(result.findings[0]?.summary).toContain('sign-in failed');
  });

  it('refuses when manifest file is missing', async () => {
    const agent = createTestActorManifestReaderAgent();
    const result = await agent.run(
      {
        manifestPath: path.join(workdir, 'does-not-exist.yaml'),
        authClient: fakeAuth(),
        envReader: () => 'pw',
      },
      fakeContext(),
    );
    expect(result.status).toBe('failed');
    expect(result.findings[0]?.summary).toContain('could not be read');
  });
});

describe('test-actor-manifest-reader — no-mutation guardrail', () => {
  it('does not invoke any auth.admin path (would require service-role key)', async () => {
    const source = await readFile(path.join('src/agents/test-actor-manifest-reader', 'agent.ts'), 'utf8');
    // Match call sites only, not doc-comment mentions of "we don't hold the service-role key."
    expect(source).not.toContain('auth.admin.createUser');
    expect(source).not.toContain('auth.admin.deleteUser');
    expect(source).not.toMatch(/import .* from '@supabase\/supabase-js'/);
  });
});
