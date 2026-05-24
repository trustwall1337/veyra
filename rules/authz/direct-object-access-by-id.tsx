// Test fixture for `direct-object-access-by-id` rule.
//
// `ruleid:` marks lines that SHOULD match; `ok:` marks lines that
// SHOULD NOT match. semgrep --test reads these markers and compares
// against the rule's actual findings.

// ---- Positive: filter by id only, then .single() ----
async function fetchOrderUnsafe(supabase: any, orderId: string) {
  // ruleid: direct-object-access-by-id
  const res = await supabase
    .from('orders')
    .select('id, total_cents')
    .eq('id', orderId)
    .single();
  return res.data;
}

// ---- Positive: id only, then .maybeSingle() ----
async function fetchOrderMaybeUnsafe(supabase: any, orderId: string) {
  // ruleid: direct-object-access-by-id
  const res = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  return res.data;
}

// ---- Negative: id AND user_id filter ----
async function fetchOrderScopedByUser(
  supabase: any,
  orderId: string,
  userId: string,
) {
  // ok: direct-object-access-by-id
  const res = await supabase
    .from('orders')
    .select('id, total_cents')
    .eq('id', orderId)
    .eq('user_id', userId)
    .single();
  return res.data;
}

// ---- Negative: id AND tenant_id filter ----
async function fetchOrderScopedByTenant(
  supabase: any,
  orderId: string,
  tenantId: string,
) {
  // ok: direct-object-access-by-id
  const res = await supabase
    .from('orders')
    .select('id, total_cents')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .single();
  return res.data;
}

// ---- Negative: not a single-row fetch ----
async function listOrders(supabase: any, tenantId: string) {
  // ok: direct-object-access-by-id
  const res = await supabase
    .from('orders')
    .select('id, total_cents')
    .eq('tenant_id', tenantId);
  return res.data;
}
