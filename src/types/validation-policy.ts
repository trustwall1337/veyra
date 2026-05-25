export type ValidationMode =
  | 'read_only_evidence'
  | 'sandbox_active_validation'
  | 'approved_production_safe';

export type EnvironmentType =
  | 'local'
  | 'dev'
  | 'preview'
  | 'staging'
  | 'sandbox'
  | 'production';

export type AllowedAction =
  | 'read_code'
  | 'read_schema_metadata'
  | 'read_storage_metadata'
  | 'read_scanner_logs'
  | 'read_application_logs'
  | 'create_synthetic_user'
  | 'create_synthetic_tenant'
  | 'create_synthetic_record'
  | 'call_api_with_test_identity'
  | 'verify_denial'
  | 'cleanup_veyra_created_data';

export interface ApprovalPolicy {
  readonly required: boolean;
  readonly approver?: string;
  readonly granted_at?: string;
  readonly scope?: readonly string[];
}

export interface ValidationPolicy {
  readonly mode: ValidationMode;
  readonly environment: EnvironmentType;
  readonly allowed_actions: ReadonlySet<AllowedAction>;
  readonly forbidden_actions: ReadonlySet<AllowedAction>;
  readonly approval: ApprovalPolicy;
}

// Retro-16 f4: `read_application_logs` is NOT in the default read-only
// set. Phase 1 step 16 explicitly says get_logs is "effectively
// disabled in Phase 1 — production logs may contain PII / secrets /
// session tokens and require explicit policy upgrade." Adding
// read_application_logs requires an explicit policy opt-in.
const READ_ONLY_ACTIONS: ReadonlySet<AllowedAction> = new Set<AllowedAction>([
  'read_code',
  'read_schema_metadata',
  'read_storage_metadata',
  'read_scanner_logs',
]);

const ACTIVE_ACTIONS: ReadonlySet<AllowedAction> = new Set<AllowedAction>([
  'create_synthetic_user',
  'create_synthetic_tenant',
  'create_synthetic_record',
  'call_api_with_test_identity',
  'verify_denial',
  'cleanup_veyra_created_data',
]);

export function defaultReadOnlyEvidencePolicy(
  env: EnvironmentType,
): ValidationPolicy {
  return {
    mode: 'read_only_evidence',
    environment: env,
    allowed_actions: READ_ONLY_ACTIONS,
    forbidden_actions: ACTIVE_ACTIONS,
    approval: { required: false },
  };
}
