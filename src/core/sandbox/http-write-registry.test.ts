import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cleanupFailedFinding } from './cleanup-failed-finding.js';
import {
  type CleanupExecutors,
  WriteRegistry,
  executeWriteWithRegistry,
} from './http-write-registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(path.dirname(HERE));

describe('WriteRegistry — record BEFORE send (Verification a)', () => {
  it('records the write entry BEFORE invoking the transport', async () => {
    const reg = new WriteRegistry();
    let observedAtSendTime = -1;
    const transport = {
      send: async () => {
        observedAtSendTime = reg.list().length;
        return { ok: true };
      },
    };
    await executeWriteWithRegistry({
      registry: reg,
      transport,
      request: { method: 'POST', url: '/probe', body_redacted: '{...}' },
      resource_id: '/probe',
      description_redacted: 'POST /probe',
    });
    expect(observedAtSendTime).toBe(1);
    expect(reg.list()).toHaveLength(1);
  });
});

describe('WriteRegistry — reverse-walk both paths (Verification c, e)', () => {
  it('roundtrip both paths yields residual_count: 0', async () => {
    const reg = new WriteRegistry();
    await executeWriteWithRegistry({
      registry: reg,
      transport: { send: async () => ({ ok: true }) },
      request: { method: 'POST', url: '/items', body_redacted: '{...}' },
      resource_id: '/items/42',
      description_redacted: 'create item',
    });
    reg.recordAdminWrite({
      resource_id: 'user-7',
      description_redacted: 'create synthetic user',
    });
    const executors: CleanupExecutors = {
      http: async () => {},
      admin: async () => {},
    };
    const proof = await reg.reverseWalk(executors);
    expect(proof.residual_count).toBe(0);
    expect(proof.attempted).toBe(2);
    expect(proof.succeeded).toBe(2);
  });

  it('walks in LIFO order so dependents are reverted first', async () => {
    const reg = new WriteRegistry();
    reg.recordAdminWrite({ resource_id: 'user-1', description_redacted: 'a' });
    reg.recordAdminWrite({ resource_id: 'tenant-1', description_redacted: 'b' });
    reg.recordHttpWrite({ resource_id: '/x', description_redacted: 'c' });
    const order: string[] = [];
    await reg.reverseWalk({
      http: async (e) => void order.push(e.resource_id),
      admin: async (e) => void order.push(e.resource_id),
    });
    expect(order).toEqual(['/x', 'tenant-1', 'user-1']);
  });
});

describe('WriteRegistry — cleanup_failed launch-blocker (Verification d)', () => {
  it('a failure on either path produces a cleanup_failed finding', async () => {
    const reg = new WriteRegistry();
    reg.recordHttpWrite({ resource_id: '/x', description_redacted: 'x' });
    reg.recordAdminWrite({ resource_id: 'user-1', description_redacted: 'u' });
    const proof = await reg.reverseWalk({
      http: async () => {
        throw new Error('http delete failed');
      },
      admin: async () => {},
    });
    expect(proof.residual_count).toBe(1);
    const finding = cleanupFailedFinding(proof);
    expect(finding.finding_type).toBe('confirmed_issue');
    expect(finding.review_action).toBe('fix_before_launch');
    expect(finding.title).toContain('1 residual');
  });
});

// ── Verification (b) — structural lint guard ────────────────────────────────
// Direct mutating writes (POST/PUT/PATCH/DELETE through a transport.send call
// or a `fetch` with method != GET) must go through executeWriteWithRegistry.
// Step 38 grandfathers the existing Phase 2 sandbox-runner agent (which is
// itself being rewired in Step 39); a NEW file outside the allowlist trips
// this test.

// Files / directory prefixes grandfathered until Step 39 rewires probes through
// `executeWriteWithRegistry`. NEW files outside this allowlist trip the test.
const LEGACY_DIRECT_WRITE_FILES: ReadonlySet<string> = new Set([
  'agents/sandbox-runner/agent.ts',
  'core/sandbox/http-write-registry.ts',
  'core/sandbox/http-write-registry.test.ts',
]);
const LEGACY_DIRECT_WRITE_PREFIXES: readonly string[] = [
  // The Phase 2 test catalog (each test case calls `transport.send` directly;
  // they are migrated under the probe-primitive split in Step 39).
  'agents/sandbox-runner/test-catalog/',
];

describe('Verification (b) — direct mutating writes outside the wrapper are flagged', () => {
  it('no NEW file outside the allowlist calls transport.send directly', async () => {
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          const rel = path.relative(SRC_DIR, full);
          if (LEGACY_DIRECT_WRITE_FILES.has(rel)) continue;
          if (LEGACY_DIRECT_WRITE_PREFIXES.some((p) => rel.startsWith(p))) continue;
          const content = await fs.readFile(full, 'utf8');
          if (/\btransport\s*\.\s*send\s*\(/.test(content)) {
            offenders.push(rel);
          }
        }
      }
    }
    await walk(SRC_DIR);
    if (offenders.length > 0) {
      throw new Error(
        `Direct transport.send() outside executeWriteWithRegistry is forbidden. Offenders:\n  - ${offenders.join('\n  - ')}`,
      );
    }
  });
});
