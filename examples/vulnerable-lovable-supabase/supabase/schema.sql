-- Veyra Phase 1 fixture schema. Each pattern below corresponds to a check in
-- FINAL_PRODUCT_PLAN.md §11 (cc-11-N). This is broken-by-design.
--
-- Storage bucket state is NOT included here: `supabase db dump` excludes
-- managed schemas including `storage`. See mcp-fixtures/supabase-storage-buckets.json
-- for the cc-11-12 fixture.

-- ============================================================
-- cc-11-5 — Sensitive table with RLS disabled.
-- Canonical-name match ("users") drives evidence_strength: high.
-- Note: ENABLE ROW LEVEL SECURITY is intentionally NOT issued.
-- ============================================================
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  tenant_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- cc-11-6 — Sensitive table with `CREATE POLICY ... USING (true)`.
-- RLS is on but the policy is effectively open.
-- ============================================================
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  total_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_select_anyone ON public.orders
  FOR SELECT
  USING (true);


-- ============================================================
-- cc-11-9 — Policy granting all rows to `authenticated` without per-row check.
-- ============================================================
CREATE TABLE public.documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  body text
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_select_authed ON public.documents
  FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- Clean fixture #1 — non-sensitive lookup table.
-- RLS on, permissive read by design. Should NOT surface as a finding.
-- ============================================================
CREATE TABLE public.timezones (
  id integer PRIMARY KEY,
  name text NOT NULL,
  utc_offset_minutes integer NOT NULL
);
ALTER TABLE public.timezones ENABLE ROW LEVEL SECURITY;
CREATE POLICY timezones_select_anyone ON public.timezones
  FOR SELECT
  USING (true);


-- ============================================================
-- Clean fixture #2 — non-sensitive feature-flag table.
-- Same pattern as timezones. Should NOT surface as a finding.
-- ============================================================
CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select_anyone ON public.feature_flags
  FOR SELECT
  USING (true);
