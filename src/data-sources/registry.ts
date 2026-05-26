/**
 * Data-source registry (step 27).
 *
 * Per FPP §2A: shared code resolves backends by opaque `DataSourceId`,
 * never by closed union. Each backend folder under `src/data-sources/`
 * calls `registerDataSource(...)` once at module load (or at CLI
 * bootstrap time); the registry stores the factories under the id.
 *
 * The registry is intentionally small. It owns the lookup contract,
 * nothing else. Backend implementations are not coupled to it — a
 * backend can be constructed directly in tests without going through
 * the registry.
 */

import type {
  CodeSource,
  DatabaseMetadataSource,
  DataSourceId,
  StorageMetadataSource,
} from '../types/data-sources.js';
import type { ValidationPolicy } from '../types/validation-policy.js';

/**
 * Per-backend factory inputs. Backends accept the customer-supplied
 * connection bits (project ref for hosted backends, file path for
 * local backends) plus the active `ValidationPolicy` so capability
 * gating runs at the call site.
 */
export interface DataSourceFactoryInputs {
  readonly policy: ValidationPolicy;
  readonly projectRef?: string;
  readonly accessToken?: string;
  readonly schemaSqlPath?: string;
  readonly projectRoot?: string;
}

export type DatabaseMetadataSourceFactory = (
  inputs: DataSourceFactoryInputs,
) => DatabaseMetadataSource;

export type StorageMetadataSourceFactory = (
  inputs: DataSourceFactoryInputs,
) => StorageMetadataSource;

export type CodeSourceFactory = (
  inputs: DataSourceFactoryInputs,
) => CodeSource;

export interface DataSourceRegistration {
  readonly id: DataSourceId;
  /**
   * Short human-readable label shown in scan-actions.log and the
   * report's Sources section. Allowed claims only (per CLAUDE.md
   * §Output language) — e.g. "Supabase Management REST API",
   * "Supabase MCP", "local SQL file".
   */
  readonly label: string;
  /**
   * Stable flag. `false` means the backend exists but its registration
   * is hidden behind `VEYRA_DEV=1` at the CLI surface. Step 27 uses
   * this to flag `supabase-mcp` and `local-sql-file` as dev-only paths
   * (per Q4 in the step file's six wrong assumptions table).
   */
  readonly devOnly: boolean;
  readonly database?: DatabaseMetadataSourceFactory;
  readonly storage?: StorageMetadataSourceFactory;
  readonly code?: CodeSourceFactory;
}

export class DataSourceRegistryError extends Error {
  override readonly name = 'DataSourceRegistryError';
}

const registrations = new Map<DataSourceId, DataSourceRegistration>();

export function registerDataSource(reg: DataSourceRegistration): void {
  if (registrations.has(reg.id)) {
    throw new DataSourceRegistryError(
      `data-source id "${reg.id}" is already registered`,
    );
  }
  registrations.set(reg.id, reg);
}

export function resolveDataSource(
  id: DataSourceId,
): DataSourceRegistration | undefined {
  return registrations.get(id);
}

export function listDataSources(): readonly DataSourceRegistration[] {
  return Array.from(registrations.values());
}

/**
 * Test-only helper. Production code never calls this; the registry is
 * idempotent across CLI runs. Tests use it to reset between runs so
 * register-twice assertions work deterministically.
 */
export function __resetRegistryForTests(): void {
  registrations.clear();
}
