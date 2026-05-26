import { describe, expect, it } from 'vitest';

import {
  DataSourceError,
  asDataSourceId,
} from './data-sources.js';

describe('asDataSourceId', () => {
  it('accepts kebab-case ids', () => {
    const r = asDataSourceId('supabase-rest');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('supabase-rest');
  });

  it('rejects empty', () => {
    const r = asDataSourceId('');
    expect(r.ok).toBe(false);
  });

  it('rejects upper-case', () => {
    const r = asDataSourceId('Supabase-Rest');
    expect(r.ok).toBe(false);
  });

  it('rejects leading digit', () => {
    const r = asDataSourceId('1-backend');
    expect(r.ok).toBe(false);
  });

  it('rejects trailing dash', () => {
    const r = asDataSourceId('foo-');
    expect(r.ok).toBe(false);
  });

  it('accepts numeric suffix', () => {
    const r = asDataSourceId('supabase-rest-v1');
    expect(r.ok).toBe(true);
  });
});

describe('DataSourceError', () => {
  it('carries the discriminator kind for capability_denied', () => {
    const e = new DataSourceError('capability_denied', 'read_code denied');
    expect(e.kind).toBe('capability_denied');
    expect(e.message).toBe('read_code denied');
  });

  it('preserves cause when supplied', () => {
    const cause = new Error('underlying');
    const e = new DataSourceError('transport_error', 'wrap', cause);
    expect(e.cause).toBe(cause);
  });

  it('uses kind=capability_not_exposed for REST-shape coverage_gap path', () => {
    const e = new DataSourceError(
      'capability_not_exposed',
      'REST does not expose policy expressions; needs human review',
    );
    expect(e.kind).toBe('capability_not_exposed');
  });

  it('uses kind=plan_not_available for Lovable Free-tier coverage_gap path (step 28a)', () => {
    const e = new DataSourceError(
      'plan_not_available',
      'Lovable code reads via OAuth require a Pro or Business plan; needs human review',
    );
    expect(e.kind).toBe('plan_not_available');
  });
});
