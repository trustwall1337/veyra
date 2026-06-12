/**
 * Body-shape predicates for active-validation probes (Step 39b Decision D).
 *
 * Pure, deterministic, Finding-free. Probe-http calls these to derive the
 * `response_returned_rows` flag from a raw HTTP body BEFORE building the
 * ProbeResponseSource ScanFact. Per-control body-predicates handle
 * domain-specific signals (declared-private columns surfaced; cross-tenant
 * ids in the response; PostgREST embed leakage).
 *
 * The default `detectReturnedRowsDefault` matches PostgREST's array-shape
 * response convention (non-empty array = rows; empty array or object = no
 * rows). Per-control predicates override this when the response shape
 * needs richer interpretation (cc-11-13b/c/d/e).
 *
 * V9 import-graph guard: this file MUST NOT import Finding.
 */

/** Default PostgREST array-shape detection. */
export function detectReturnedRowsDefault(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === '[]') return false;
  if (trimmed.startsWith('[')) {
    return true;
  }
  // Object response — typically a PostgREST error (`{code, message, ...}`)
  // OR a non-array single-resource response. Conservative: no rows.
  return false;
}

/**
 * Parse a JSON body safely. Returns undefined on parse failure so callers
 * fall through to a defensive "no rows" verdict without throwing.
 */
function parseJsonOrUndefined(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * cc-11-13b: response leaked a declared-private column. The predicate is
 * true iff the response is a non-empty array AND any element contains any
 * of the declared-private column names as a key.
 */
export function detectPrivateColumnLeak(
  body: string,
  privateColumns: readonly string[],
): boolean {
  const parsed = parseJsonOrUndefined(body);
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  for (const row of parsed) {
    if (row !== null && typeof row === 'object') {
      const obj = row as Record<string, unknown>;
      for (const col of privateColumns) {
        if (Object.prototype.hasOwnProperty.call(obj, col)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * cc-11-13c / cc-11-13e: response contains rows whose `tenantColumn` value
 * is NOT the actor's tenant. The predicate is true iff the response is a
 * non-empty array AND any element's `tenantColumn` value differs from the
 * expected `actorTenantValue`.
 */
export function detectCrossTenantRows(
  body: string,
  tenantColumn: string,
  actorTenantValue: string,
): boolean {
  const parsed = parseJsonOrUndefined(body);
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  for (const row of parsed) {
    if (row !== null && typeof row === 'object') {
      const obj = row as Record<string, unknown>;
      const observed = obj[tenantColumn];
      if (typeof observed === 'string' && observed !== actorTenantValue) {
        return true;
      }
    }
  }
  return false;
}

/**
 * cc-11-13d: PostgREST embed surfaced cross-tenant data via a foreign-table
 * lookup. The predicate is true iff any embedded foreignTable rows leaked
 * from a different tenant. Same logic as detectCrossTenantRows but applied
 * to nested embed objects.
 */
export function detectEmbedCrossTenantRows(
  body: string,
  foreignTable: string,
  tenantColumn: string,
  actorTenantValue: string,
): boolean {
  const parsed = parseJsonOrUndefined(body);
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  for (const row of parsed) {
    if (row !== null && typeof row === 'object') {
      const obj = row as Record<string, unknown>;
      const embedded = obj[foreignTable];
      if (Array.isArray(embedded)) {
        for (const child of embedded) {
          if (child !== null && typeof child === 'object') {
            const childObj = child as Record<string, unknown>;
            const observed = childObj[tenantColumn];
            if (typeof observed === 'string' && observed !== actorTenantValue) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * cc-11-1: API route returned a non-trivial JSON body (NOT an HTML SPA
 * shell). The predicate is true iff the response is a non-empty JSON
 * object or array AND the content-type indicates JSON. Body-only check
 * suffices when probe-http sets `Accept: application/json`.
 *
 * codex 39b-005 [APPLIED]: a 200 returning HTML is a SPA shell, not
 * protected-data evidence; predicate returns false → outcome is
 * inconclusive → no launch-blocker finding.
 */
export function detectProtectedJsonContent(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('<')) return false; // HTML shell
  const parsed = parseJsonOrUndefined(body);
  if (parsed === undefined) return false;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (parsed !== null && typeof parsed === 'object') {
    return Object.keys(parsed as Record<string, unknown>).length > 0;
  }
  return false;
}
