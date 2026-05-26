import type {
  AnalyzerId,
  ConnectorId,
  ScannerId,
} from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';
import type { ActionExecutor } from '../policy/executors/types.js';

export class RegistryError extends Error {
  override readonly name = 'RegistryError';
}

export interface ConnectorDescriptor {
  readonly id: ConnectorId;
  readonly displayName: string;
}

export interface ScannerDescriptor {
  readonly id: ScannerId;
  readonly displayName: string;
}

export interface AnalyzerDescriptor {
  readonly id: AnalyzerId;
  readonly displayName: string;
}

/**
 * Step 2.03 codex P203-003: ActionExecutors register here by `ConnectorId`
 * (each connector that supports active validation may register one).
 * Shared code resolves the executor via `lookupExecutor(id)`; there is
 * no closed-union branching on connector name.
 */
export interface ActionExecutorDescriptor {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly executor: ActionExecutor;
}

/**
 * Single per-process registry that connectors, scanners, and analyzers
 * register into at module-load time. Shared code MUST NOT switch on raw
 * service-name strings — all resolution flows through this registry.
 */
export class ServiceRegistry {
  readonly #connectors = new Map<string, ConnectorDescriptor>();
  readonly #scanners = new Map<string, ScannerDescriptor>();
  readonly #analyzers = new Map<string, AnalyzerDescriptor>();
  readonly #executors = new Map<string, ActionExecutorDescriptor>();

  registerConnector(d: ConnectorDescriptor): Result<void, RegistryError> {
    if (this.#connectors.has(d.id)) {
      return err(new RegistryError(`Connector id collision: ${d.id}`));
    }
    this.#connectors.set(d.id, d);
    return ok(undefined);
  }

  registerScanner(d: ScannerDescriptor): Result<void, RegistryError> {
    if (this.#scanners.has(d.id)) {
      return err(new RegistryError(`Scanner id collision: ${d.id}`));
    }
    this.#scanners.set(d.id, d);
    return ok(undefined);
  }

  registerAnalyzer(d: AnalyzerDescriptor): Result<void, RegistryError> {
    if (this.#analyzers.has(d.id)) {
      return err(new RegistryError(`Analyzer id collision: ${d.id}`));
    }
    this.#analyzers.set(d.id, d);
    return ok(undefined);
  }

  lookupConnector(
    id: ConnectorId,
  ): Result<ConnectorDescriptor, RegistryError> {
    const d = this.#connectors.get(id);
    if (d === undefined) {
      return err(new RegistryError(`Unknown connector id: ${id}`));
    }
    return ok(d);
  }

  lookupScanner(id: ScannerId): Result<ScannerDescriptor, RegistryError> {
    const d = this.#scanners.get(id);
    if (d === undefined) {
      return err(new RegistryError(`Unknown scanner id: ${id}`));
    }
    return ok(d);
  }

  lookupAnalyzer(id: AnalyzerId): Result<AnalyzerDescriptor, RegistryError> {
    const d = this.#analyzers.get(id);
    if (d === undefined) {
      return err(new RegistryError(`Unknown analyzer id: ${id}`));
    }
    return ok(d);
  }

  registerExecutor(d: ActionExecutorDescriptor): Result<void, RegistryError> {
    if (this.#executors.has(d.id)) {
      return err(new RegistryError(`Executor id collision: ${d.id}`));
    }
    this.#executors.set(d.id, d);
    return ok(undefined);
  }

  lookupExecutor(
    id: ConnectorId,
  ): Result<ActionExecutorDescriptor, RegistryError> {
    const d = this.#executors.get(id);
    if (d === undefined) {
      return err(new RegistryError(`Unknown executor id: ${id}`));
    }
    return ok(d);
  }

  listExecutors(): readonly ActionExecutorDescriptor[] {
    return Array.from(this.#executors.values());
  }

  /** Test-only: clear all registrations. */
  reset(): void {
    this.#connectors.clear();
    this.#scanners.clear();
    this.#analyzers.clear();
    this.#executors.clear();
  }
}

export const registry = new ServiceRegistry();
