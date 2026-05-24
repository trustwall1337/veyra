import type {
  AnalyzerId,
  ConnectorId,
  ScannerId,
} from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';

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
 * Single per-process registry that connectors, scanners, and analyzers
 * register into at module-load time. Shared code MUST NOT switch on raw
 * service-name strings — all resolution flows through this registry.
 */
export class ServiceRegistry {
  readonly #connectors = new Map<string, ConnectorDescriptor>();
  readonly #scanners = new Map<string, ScannerDescriptor>();
  readonly #analyzers = new Map<string, AnalyzerDescriptor>();

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

  /** Test-only: clear all registrations. */
  reset(): void {
    this.#connectors.clear();
    this.#scanners.clear();
    this.#analyzers.clear();
  }
}

export const registry = new ServiceRegistry();
