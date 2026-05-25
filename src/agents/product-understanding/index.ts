export { productUnderstandingAgent } from './agent.js';
export type {
  ProductUnderstandingInput,
  ProductUnderstandingOutput,
} from './agent.js';
// Re-export the inventory module's public API for callers that want
// to compose the inventory pass independently.
export {
  INVENTORY_BOOTSTRAP_ARTIFACT_NAME,
  buildBootstrapInventory,
  writeInventoryArtifact,
  type BootstrapFs,
  type BootstrapMcpFetchers,
  type BuildBootstrapInventoryOptions,
} from './inventory/bootstrap.js';
export type {
  DetectedFramework,
  InventoryBootstrap,
  InventoryObservedEvidence,
  InventorySource,
  PackageJsonDigest,
  SupabaseSchemaSummary,
} from './inventory/types.js';
export { BootstrapError } from './inventory/types.js';
