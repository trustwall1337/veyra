// Test fixture for `client-provided-tenant-id` rule.

// ---- Positive: read tenant_id from URL search params ----
function DashboardPage(params: URLSearchParams) {
  // ruleid: client-provided-tenant-id
  const tenantId = params.get('tenant_id');
  return tenantId;
}

// ---- Positive: read org_id from URL search params ----
function fromQueryParams(params: URLSearchParams) {
  // ruleid: client-provided-tenant-id
  const orgId = params.get('org_id');
  return orgId;
}

// ---- Positive: workspace_id read ----
function fromUrl(params: URLSearchParams) {
  // ruleid: client-provided-tenant-id
  const ws = params.get('workspace_id');
  return ws;
}

// ---- Negative: direct property access on a session object ----
// (Tenant id derived from the authenticated session is a safe pattern;
//  the rule is intentionally narrowed to URLSearchParams .get() so this
//  shape does NOT match.)
function fromSession(session: { user: { app_metadata: { tenant_id: string } } }) {
  // ok: client-provided-tenant-id
  return session.user.app_metadata.tenant_id;
}

// ---- Negative: tenant id derived from the authenticated session ----
async function deriveFromSession(supabase: any) {
  // ok: client-provided-tenant-id
  const { data } = await supabase.auth.getUser();
  const tenantId = data.user?.app_metadata?.tenant_id;
  return tenantId;
}

// ---- Negative: a different param name (not in the rule list) ----
function searchByName(params: URLSearchParams) {
  // ok: client-provided-tenant-id
  const name = params.get('search_name');
  return name;
}
