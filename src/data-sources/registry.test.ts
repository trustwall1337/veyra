import { afterEach, describe, expect, it } from 'vitest';

import {
  DataSourceRegistryError,
  __resetRegistryForTests,
  listDataSources,
  registerDataSource,
  resolveDataSource,
} from './registry.js';
import {
  asDataSourceId,
  type DatabaseMetadataSource,
} from '../types/data-sources.js';

function id(s: string) {
  const r = asDataSourceId(s);
  if (!r.ok) throw new Error(`bad id: ${s}`);
  return r.value;
}

const stubDb: DatabaseMetadataSource = {
  id: id('stub-db'),
  async fetchTables() {
    return { ok: true, value: [] };
  },
  async fetchPolicies() {
    return { ok: true, value: [] };
  },
};

afterEach(() => __resetRegistryForTests());

describe('registry', () => {
  it('round-trips a registration', () => {
    registerDataSource({
      id: id('alpha'),
      label: 'Alpha backend',
      devOnly: false,
      database: () => stubDb,
    });
    const r = resolveDataSource(id('alpha'));
    expect(r).toBeDefined();
    expect(r?.label).toBe('Alpha backend');
    expect(r?.devOnly).toBe(false);
  });

  it('rejects double-registration of the same id', () => {
    registerDataSource({ id: id('alpha'), label: 'A', devOnly: false });
    expect(() =>
      registerDataSource({ id: id('alpha'), label: 'A again', devOnly: false }),
    ).toThrow(DataSourceRegistryError);
  });

  it('returns undefined for unknown id', () => {
    expect(resolveDataSource(id('missing'))).toBeUndefined();
  });

  it('listDataSources returns every registration', () => {
    registerDataSource({ id: id('alpha'), label: 'A', devOnly: false });
    registerDataSource({ id: id('beta'), label: 'B', devOnly: true });
    const ids = listDataSources().map((r) => r.id);
    expect(ids).toContain(id('alpha'));
    expect(ids).toContain(id('beta'));
  });

  it('preserves devOnly flag separately from id', () => {
    registerDataSource({ id: id('dev-only'), label: 'Dev', devOnly: true });
    const r = resolveDataSource(id('dev-only'));
    expect(r?.devOnly).toBe(true);
  });
});
