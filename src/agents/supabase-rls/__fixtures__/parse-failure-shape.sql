--
-- Step 26 Piece 2 fixture: a non-trivial dump (≥1024 bytes) with
-- SQL signal lines (CREATE TABLE / CREATE POLICY / ENABLE ROW LEVEL
-- SECURITY) that the parser CANNOT extract — exercises the loud-
-- failure path. Each statement uses a deliberately-unsupported
-- syntactic variant (multi-line column lists, custom domain types,
-- inheritance clauses) the regex set is not built for.
--

SET statement_timeout = 0;
SET lock_timeout = 0;

-- CREATE TABLE buried inside a multi-line DO $$ block — parser tags
-- this as `unparseable` rather than extracting it.
DO $$
DECLARE
  v_dummy int;
BEGIN
  CREATE TABLE if_only_we_could_parse_this (
    id serial
  );
END;
$$;

-- CTE-shaped statement; parser tags this as `unparseable` rather
-- than extracting the inner CREATE TABLE.
WITH dummy AS (
  SELECT 1
)
SELECT * FROM dummy;

-- Another DO block with CREATE POLICY inside.
DO $$
BEGIN
  CREATE POLICY hidden_policy ON some_table USING (true);
END;
$$;

-- Multiple ENABLE ROW LEVEL SECURITY lines that reference table
-- names the parser never saw (because their CREATE TABLE lives
-- inside the DO blocks above).
ALTER TABLE invisible_one ENABLE ROW LEVEL SECURITY;
ALTER TABLE invisible_two ENABLE ROW LEVEL SECURITY;
ALTER TABLE invisible_three ENABLE ROW LEVEL SECURITY;

-- Filler comments to keep the byte count above MIN_NONTRIVIAL_DUMP_BYTES.
-- One realistic Supabase dump pattern is hundreds of bytes of preamble
-- before the first useful statement. This fixture intentionally pads
-- the file so the byte-count gate fires (>1024) even though parser
-- output is empty.
--
-- The point of this fixture: prove that the agent emits a clear
-- parse_failure coverage_gap signal instead of silent needs_review.
-- Adding more comment lines below preserves the failure shape.
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
