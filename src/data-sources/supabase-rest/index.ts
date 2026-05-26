/**
 * Supabase REST backend registration (step 27).
 *
 * Calling this once at CLI bootstrap registers `supabase-rest` as a
 * data-source backend in the registry. Tests construct the backend
 * directly without going through the registry.
 */

import { asDataSourceId, type DataSourceId } from '../../types/data-sources.js';
import { registerDataSource } from '../registry.js';

import {
  createSupabaseRestClient,
  SupabaseRestConfigurationError,
} from './client.js';
import { createSupabaseRestDatabase } from './database.js';
import { createSupabaseRestStorage } from './storage.js';

const SUPABASE_REST_ID: DataSourceId = (() => {
  const r = asDataSourceId('supabase-rest');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const supabaseRestId: DataSourceId = SUPABASE_REST_ID;

export { createSupabaseRestClient, createSupabaseRestDatabase, createSupabaseRestStorage };

export function registerSupabaseRest(): void {
  registerDataSource({
    id: SUPABASE_REST_ID,
    label: 'Supabase Management REST API',
    devOnly: false,
    database: ({ projectRef, accessToken, policy }) => {
      if (projectRef === undefined || accessToken === undefined) {
        throw new SupabaseRestConfigurationError(
          'supabase-rest requires projectRef and accessToken',
        );
      }
      const client = createSupabaseRestClient({
        projectRef,
        accessToken,
        policy,
      });
      return createSupabaseRestDatabase(SUPABASE_REST_ID, client);
    },
    storage: ({ projectRef, accessToken, policy }) => {
      if (projectRef === undefined || accessToken === undefined) {
        throw new SupabaseRestConfigurationError(
          'supabase-rest requires projectRef and accessToken',
        );
      }
      const client = createSupabaseRestClient({
        projectRef,
        accessToken,
        policy,
      });
      return createSupabaseRestStorage(SUPABASE_REST_ID, client);
    },
  });
}
