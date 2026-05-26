/**
 * Negative-test catalog (step 2.07).
 *
 * Re-exports every catalog entry. The sandbox-runner agent (step
 * 2.08) consumes `ALL_ENTRIES`; drift-guard tests consume
 * `getCatalogControlIds()` to verify each entry's exported
 * `controlId` matches `controls.ts`.
 */

import cc111 from './cc-11-1-frontend-only-no-auth.js';
import cc112 from './cc-11-2-non-admin-to-admin-route.js';
import cc113 from './cc-11-3-direct-object-access.js';
import cc114 from './cc-11-4-client-tenant-id-override.js';
import cc115 from './cc-11-5-cross-tenant-read-rls-off.js';
import cc116 from './cc-11-6-broad-rls-policy.js';
import cc119 from './cc-11-9-all-auth-cross-tenant-access.js';
import cc1112 from './cc-11-12-anon-to-private-bucket.js';
import cc1113a from './cc-11-13a-openapi-table-enumeration.js';
import cc1113b from './cc-11-13b-select-star-column-leak.js';
import cc1113c from './cc-11-13c-cross-tenant-filter-bypass.js';
import cc1113d from './cc-11-13d-foreign-table-embed-leak.js';
import cc1113e from './cc-11-13e-private-column-filter-enumeration.js';

import type { CatalogEntry } from './types.js';

export const ALL_ENTRIES: readonly CatalogEntry[] = [
  cc111,
  cc112,
  cc113,
  cc114,
  cc115,
  cc116,
  cc119,
  cc1112,
  cc1113a,
  cc1113b,
  cc1113c,
  cc1113d,
  cc1113e,
];

export function getCatalogControlIds(): readonly string[] {
  return ALL_ENTRIES.map((e) => e.controlId);
}

export function findEntryByControlId(controlId: string): CatalogEntry | undefined {
  return ALL_ENTRIES.find((e) => e.controlId === controlId);
}

export type { CatalogEntry, NegativeTestInput, HttpResponse, HttpTransport, FixtureOutcomeSpec } from './types.js';
