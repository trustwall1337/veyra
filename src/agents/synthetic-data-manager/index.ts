export {
  CLEANUP_PROOF_ARTIFACT,
  CLEANUP_RETRY_DELAYS_MS,
  SYNTHETIC_DATA_MANAGER_AGENT_ID,
  SYNTHETIC_RESOURCES_ARTIFACT,
  createSyntheticDataManagerAgent,
  runSynthesizePhase,
  runCleanupPhase,
} from './agent.js';
export type {
  CleanupProof,
  SynthesizeOutput,
  SyntheticDataManagerInput,
  SyntheticDataManagerOutput,
  SyntheticIdentitySpec,
} from './agent.js';
