--
-- De-novo minimal pg_dump-shape fixture for step 26.
-- Manually constructed; not derived from any real customer's dump.
-- Mirrors the syntactic shape `supabase db dump --linked` emits:
--   quoted schema-qualified identifiers, IF NOT EXISTS, schema-
--   prefixed ALTER TABLE RLS, multi-line CREATE POLICY with USING.
--
-- The parser must produce ≥1 table with rls_enabled correctly set
-- and ≥1 policy with a USING expression captured.
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "public";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "public";

CREATE TABLE IF NOT EXISTS "public"."accounts" (
  "id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "name" text
);

ALTER TABLE "public"."accounts" OWNER TO "postgres";

ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_owner_select" ON "public"."accounts"
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = owner_id));

CREATE TABLE IF NOT EXISTS "public"."open_lookup" (
  "id" int NOT NULL,
  "label" text
);

COMMENT ON TABLE "public"."open_lookup" IS 'Intentionally not RLS-protected; lookup table.';
