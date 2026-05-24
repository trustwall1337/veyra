// Test fixture for `admin-route-data-fetch` rule.

// ---- Positive: function name starts with "Admin", fetches via Supabase ----
export function AdminPage(supabase: any) {
  // ruleid: admin-route-data-fetch
  return supabase.from('users').select('id, email, role');
}

// ---- Positive: another Admin-prefixed function ----
export function AdminOrdersListing(supabase: any) {
  // ruleid: admin-route-data-fetch
  return supabase.from('orders').select('*');
}

// ---- Negative: same Supabase call, function name does not start with Admin ----
export function DashboardPage(supabase: any) {
  // ok: admin-route-data-fetch
  return supabase.from('documents').select('id');
}

// ---- Negative: name contains "admin" lowercase (regex requires capital A) ----
export function adminDashboard(supabase: any) {
  // ok: admin-route-data-fetch
  return supabase.from('admins').select('id');
}
