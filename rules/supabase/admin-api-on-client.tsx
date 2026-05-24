// Test fixture for `admin-api-on-client` rule.

// ---- Positive: supabase.auth.admin.deleteUser ----
async function deleteUser(supabase: any, id: string) {
  // ruleid: admin-api-on-client
  const res = await supabase.auth.admin.deleteUser(id);
  return res;
}

// ---- Positive: supabase.auth.admin.listUsers ----
async function listUsers(supabase: any) {
  // ruleid: admin-api-on-client
  const res = await supabase.auth.admin.listUsers();
  return res;
}

// ---- Positive: supabase.auth.admin.updateUserById ----
async function promoteUser(supabase: any, id: string) {
  // ruleid: admin-api-on-client
  const res = await supabase.auth.admin.updateUserById(id, { role: 'admin' });
  return res;
}

// ---- Negative: non-admin auth call ----
async function signIn(supabase: any) {
  // ok: admin-api-on-client
  const res = await supabase.auth.signInWithPassword({
    email: 'a@b.c',
    password: 'x',
  });
  return res;
}

// ---- Negative: getUser (read-only, client-safe) ----
async function whoAmI(supabase: any) {
  // ok: admin-api-on-client
  const res = await supabase.auth.getUser();
  return res;
}
