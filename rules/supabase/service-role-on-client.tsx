// Test fixture for `service-role-on-client` rule.

// ---- Positive: Vite client env exposes the service-role key ----
function viteClient() {
  // ruleid: service-role-on-client
  const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  return key;
}

// ---- Positive: CRA client env ----
function craClient() {
  // ruleid: service-role-on-client
  const key = process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;
  return key;
}

// ---- Positive: Next.js client-exposed env ----
function nextClient() {
  // ruleid: service-role-on-client
  const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  return key;
}

// ---- Negative: anon key (client-exposable by design) ----
function anonClient() {
  // ok: service-role-on-client
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return key;
}

// ---- Negative: server-only env reference (no client prefix) ----
function serverOnly() {
  // ok: service-role-on-client
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key;
}
