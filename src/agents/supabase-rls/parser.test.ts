/**
 * Schema parser unit tests (step 26).
 *
 * Covers:
 *  - quoted-identifier + IF NOT EXISTS variants from real
 *    `supabase db dump --linked` output (the 2026-05-25 regression).
 *  - the pre-step-26 fixture syntax (unquoted, schema-bare forms)
 *    keeps parsing the same way.
 *  - skip-list for SET / COMMENT / OWNER / CREATE EXTENSION / etc.
 *    so they don't pollute `unparseable[]`.
 *  - the inverse: a non-trivial dump with SQL signal lines but the
 *    parser can't extract anything returns the empty ParsedSchema
 *    (the loud-failure gate that consumes this lives in the agent,
 *    not the parser).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSchemaSql } from './parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, '__fixtures__');

describe('parseSchemaSql — quoted, schema-qualified pg_dump syntax (step 26 Piece 1)', () => {
  it('parses CREATE TABLE IF NOT EXISTS "public"."accounts" → schema=public, name=accounts', async () => {
    const sql = await fs.readFile(
      path.join(FIXTURES_DIR, 'real-pgdump-minimal.sql'),
      'utf8',
    );
    const parsed = parseSchemaSql(sql);
    expect(parsed.tables.length).toBeGreaterThan(0);
    const accounts = parsed.tables.find(
      (t) => t.schema === 'public' && t.name === 'accounts',
    );
    expect(accounts).toBeDefined();
    expect(accounts?.rls_enabled).toBe(true);
    const openLookup = parsed.tables.find(
      (t) => t.schema === 'public' && t.name === 'open_lookup',
    );
    expect(openLookup).toBeDefined();
    expect(openLookup?.rls_enabled).toBe(false);
  });

  it('parses CREATE POLICY "name" ON "public"."accounts" with USING expression captured', async () => {
    const sql = await fs.readFile(
      path.join(FIXTURES_DIR, 'real-pgdump-minimal.sql'),
      'utf8',
    );
    const parsed = parseSchemaSql(sql);
    expect(parsed.policies.length).toBeGreaterThan(0);
    const p = parsed.policies.find((pol) => pol.name === 'accounts_owner_select');
    expect(p).toBeDefined();
    expect(p?.schema).toBe('public');
    expect(p?.table).toBe('accounts');
    expect(p?.operation).toBe('SELECT');
    expect(p?.role).toBe('authenticated');
    expect(p?.using_expr).toMatch(/auth\.uid\(\)\s*=\s*owner_id/);
  });

  it('skips pg_dump preamble (SET / SELECT pg_catalog.set_config / COMMENT / OWNER / CREATE EXTENSION / CREATE SCHEMA) without polluting unparseable[]', async () => {
    const sql = await fs.readFile(
      path.join(FIXTURES_DIR, 'real-pgdump-minimal.sql'),
      'utf8',
    );
    const parsed = parseSchemaSql(sql);
    // Preamble lines must not surface as parser failures.
    expect(parsed.unparseable).toEqual([]);
  });
});

describe('parseSchemaSql — unquoted, schema-bare syntax (pre-step-26 fixture stays parsing)', () => {
  it('still parses CREATE TABLE public.users + ALTER TABLE public.users ENABLE ROW LEVEL SECURITY', () => {
    const sql = `
CREATE TABLE public.users (
  id uuid NOT NULL
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_anyone ON public.orders
  FOR SELECT
  USING (true);
`;
    const parsed = parseSchemaSql(sql);
    const users = parsed.tables.find(
      (t) => t.schema === 'public' && t.name === 'users',
    );
    expect(users).toBeDefined();
    const orders = parsed.tables.find(
      (t) => t.schema === 'public' && t.name === 'orders',
    );
    expect(orders).toBeDefined();
    expect(orders?.rls_enabled).toBe(true);
    expect(parsed.policies).toHaveLength(1);
    expect(parsed.policies[0]?.using_expr).toBe('true');
  });
});

describe('parseSchemaSql — failure-shape (step 26 Piece 2 input)', () => {
  it('a non-trivial dump with CREATE TABLE / CREATE POLICY / ENABLE RLS lines inside DO blocks returns empty tables + policies', async () => {
    const sql = await fs.readFile(
      path.join(FIXTURES_DIR, 'parse-failure-shape.sql'),
      'utf8',
    );
    expect(Buffer.byteLength(sql, 'utf8')).toBeGreaterThan(1024);
    const parsed = parseSchemaSql(sql);
    // The parser correctly extracts NOTHING from this input — the
    // agent's loud-failure gate is what turns this into the
    // operator-visible coverage_gap (see agent.ts loud-failure path
    // and its e2e assertion below).
    expect(parsed.tables).toEqual([]);
    expect(parsed.policies).toEqual([]);
  });
});
