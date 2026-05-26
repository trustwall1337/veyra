/**
 * SandboxExecutor registration (step 2.03).
 *
 * Calling `registerSandboxExecutor(registry)` once at bootstrap binds
 * the Supabase handler bundle to a `supabase` ConnectorId and inserts
 * the executor into the service registry. Step 2.06 replaces the
 * Supabase handler stubs with real Admin SDK calls; the registration
 * surface stays the same.
 */

import { asConnectorId, type ConnectorId } from '../../../../types/identity.js';
import {
  ServiceRegistry,
  type ActionExecutorDescriptor,
} from '../../../registry/service-registry.js';

import { createSandboxExecutor } from './executor.js';
import { buildSupabaseHandlers } from './handlers/supabase.js';

const SUPABASE_CONNECTOR_ID: ConnectorId = (() => {
  const r = asConnectorId('supabase');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const supabaseSandboxConnectorId: ConnectorId = SUPABASE_CONNECTOR_ID;

export function registerSandboxExecutor(
  registry: ServiceRegistry,
): import('../../../../types/result.js').Result<
  void,
  import('../../../registry/service-registry.js').RegistryError
> {
  const executor = createSandboxExecutor({
    id: SUPABASE_CONNECTOR_ID,
    handlers: buildSupabaseHandlers({ executorId: SUPABASE_CONNECTOR_ID }),
  });
  const descriptor: ActionExecutorDescriptor = {
    id: SUPABASE_CONNECTOR_ID,
    displayName: 'Supabase sandbox executor (Phase 2)',
    executor,
  };
  return registry.registerExecutor(descriptor);
}

export { createSandboxExecutor } from './executor.js';
export { buildSupabaseHandlers, NotImplementedError } from './handlers/supabase.js';
