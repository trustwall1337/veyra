// cc-11-8 — Hardcoded JWT-shaped fake key.
//
// This is a FIXTURE VALUE. It is not a real Supabase service-role key. The
// payload literally encodes {"fixture":"VEYRA_FIXTURE_DO_NOT_USE"}. Gitleaks
// should match this on the JWT pattern; Veyra must run gitleaks with --redact
// so the value never appears raw in artifacts, logs, or reports.
export const SUPABASE_SERVICE_ROLE_KEY_FAKE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJmaXh0dXJlIjoiVkVZUkFfRklYVFVSRV9ET19OT1RfVVNFIn0.REDACT_ME_fake_signature_do_not_use';
