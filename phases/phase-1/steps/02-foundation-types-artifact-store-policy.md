# Step 02 — Foundation types, artifact store, policy guard, orchestrator skeleton

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 2`, §4.0 architecture, §5 finding model
**Produces:** types in `src/types/`, infra in `src/core/{artifacts,orchestrator,policy}/`
**Depends on:** 01
**Executed by:** plain coding pass (this is the foundation other skills depend on)
**Verification:** Vitest unit tests on artifact store roundtrip, policy guard deny-path, and `ValidationPolicy` enforcement; `pnpm typecheck`

## Goal

Land the typed contracts and runtime primitives every agent, connector, scanner, and reporter will import. This includes the **validation-policy seam** — Phase 1 only executes the read-only branch, but the policy type and per-call enforcement exist from day one so Phase 2 doesn't require a redesign.

Nothing in `src/agents/`, `src/connectors/`, or `src/scanners/` can compile until this step is done.

## What lands

### Core agent + artifact types

- `src/types/agent.ts` — `VeyraAgent<I, O>`, `AgentExecutionContext` (carries `ValidationPolicy`), `AgentResult<O>`, `AgentMetadata` (id, version, declared dependencies).
- `src/types/artifact.ts` — `ArtifactRef`, `Artifact<T>`, allowed artifact kinds.
- `src/types/finding.ts` — `Finding` with `finding_type`, `evidence_strength`, `reproducibility`, `review_action`, `blast_radius` enums verbatim from `PHASE_1_PLAN §5`.
- `src/types/control-card.ts` — `ControlCard` matching `FINAL_PRODUCT_PLAN §9.3`. `readiness_status` enum: `launch_blocker | needs_review | evidence_present | proven_in_sandbox` (last value reserved; Phase 1 never emits it).
- `src/types/evidence.ts` — `EvidenceItem` as a **discriminated union** of `EvidenceKind`. **The inner provider/scanner identities are opaque branded ID types**, not closed string unions — see `FINAL_PRODUCT_PLAN §2A` extensibility rules. The discriminator is the `source` field; provider names are not part of the type system:
  - `{ source: 'static_code', file, line? }`
  - `{ source: 'mcp_context', server: ConnectorId, tool: string, request_fingerprint: string }`
  - `{ source: 'scanner', scanner: ScannerId, finding_id: string }`
  - `{ source: 'active_validation', test_id, outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive', synthetic_data_refs }` *(Phase 2, type only)*
  - `{ source: 'cleanup_proof', scan_id, residual_count }` *(Phase 2, type only)*
- `src/types/readiness-report.ts` — `ReadinessReport` shape consumed by reporters.
- `src/types/suggested-test.ts` — `SuggestedTest` shape.
- `src/types/errors.ts` — `PolicyViolationError`, `RedactionError`, `ScannerNotInstalledError`.

### Extensibility / registry types (per `FINAL_PRODUCT_PLAN §2A`)

- `src/types/identity.ts` — opaque branded ID types:
  - `ConnectorId` (e.g. for `lovable`, `supabase`, future `firebase`, `clerk`, `github`, etc.)
  - `ScannerId` (e.g. for `gitleaks`, `osv`, `semgrep`, future `trivy`, `bearer`, `codeql`, etc.)
  - `AnalyzerId` (e.g. for `authn`, `authz-tenant`, `supabase-rls`, future `graphql-authz`, `grpc-authz`, `kafka-acl`, etc.)
  - Each is `string & { __brand: '<id-kind>' }`. Constructed via factory (`asConnectorId(s)`) that validates non-empty + matches registered ids at runtime.
- `src/core/registry/service-registry.ts` — a single registry that connectors / scanners / analyzers register into at module-load time. The registry validates id uniqueness and exposes a typed lookup. **No shared code may switch on raw service-name strings.** All resolution goes through the registry.
- Tests: registry collision test, unknown-id rejection test, exhaustive walk of `EvidenceKind` via the discriminator.

### Validation-policy types (NEW seam — types land here, only read-only branch is wired in Phase 1)

- `src/types/validation-policy.ts`:
  - `ValidationMode = 'read_only_evidence' | 'sandbox_active_validation' | 'approved_production_safe'`
  - `EnvironmentType = 'local' | 'dev' | 'preview' | 'staging' | 'sandbox' | 'production'`
  - `AllowedAction` — string union: `read_code`, `read_schema_metadata`, `read_storage_metadata`, `read_scanner_logs`, `read_application_logs`, `create_synthetic_user`, `create_synthetic_tenant`, `create_synthetic_record`, `call_api_with_test_identity`, `verify_denial`, `cleanup_veyra_created_data`.
  - `ApprovalPolicy = { required: boolean; approver?: string; granted_at?: string; scope?: string[] }`
  - `ValidationPolicy = { mode, environment, allowed_actions: ReadonlySet<AllowedAction>, forbidden_actions: ReadonlySet<AllowedAction>, approval: ApprovalPolicy }`
  - Default factory `defaultReadOnlyEvidencePolicy(env: EnvironmentType): ValidationPolicy`.
- `src/types/active-validation.ts` — **intentionally empty placeholder** with TSDoc note that Phase 2 will land `TestIdentity`, `TestTenant`, `SyntheticDataPolicy`, `CleanupPolicy`, `ActiveValidationResult`. Reserving the file prevents Phase 2 from inventing a parallel location. NOT imported anywhere in Phase 1.

### Infra

- `src/core/artifacts/artifact-store.ts` — append-only artifact store keyed by scan id; reads/writes via typed `ArtifactRef`.
- `src/core/orchestrator/scan-orchestrator.ts` — skeleton only (agent registration, topo-sort placeholder, per-agent try-boundary). Full wiring lands in step 18.
- `src/core/policy/tool-policy.ts` — `enforce(toolCall, policy)` returning `Result<void, PolicyViolationError>`. **Decisions go through `policy.allowed_actions.has('<action>')`**, never `policy.mode === '...'`. Takes service identity as parameter — no hard-coded `lovable | supabase` switch.

## Done when

- Every type compiles under strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`, no `!`).
- Artifact store roundtrip test passes: write `Finding[]`, read it back, types preserved.
- Policy guard tests pass: (a) default `read_only_evidence` policy denies `create_synthetic_user`; (b) unknown tool returns `PolicyViolationError`; (c) allowlisted action returns `ok`; (d) policy decisions consult `allowed_actions`, not `mode`.
- `EvidenceKind` discriminated union has an exhaustiveness check that fails the build if a new kind is added without a handler.
- `src/types/active-validation.ts` exists with intentional-emptiness TSDoc; no other file imports from it in Phase 1.
- `pnpm typecheck` is green.
- `src/types/result.ts` (already exists) is reused — not duplicated.

## Guardrails

- No `import` line in `src/types/` or `src/core/` may point at `src/agents/`, `src/connectors/`, or `src/scanners/`. Foundation depends on nothing in those folders.
- **No hardcoded provider names in shared types** (per `FINAL_PRODUCT_PLAN §2A`). Discriminated unions in `src/types/` use opaque `ConnectorId` / `ScannerId` / `AnalyzerId` types, not `'lovable' | 'supabase'` style closed enums. The compiler must not learn that "lovable" and "supabase" are the universe of connectors.
- The registry is the only place that knows which services exist. Adding a new connector in a future phase = new folder + registry entry, no shared-type edits.
- **Policy is the authority for capability decisions.** Code paths check `policy.allowed_actions.has('<action>')`. Reading `policy.mode` is for telemetry/reporting only, never for gating.
- `Finding.finding_type` enum exactly: `confirmed_issue | likely_issue | missing_evidence | coverage_gap | informational`.
- `Finding.reproducibility` enum exactly: `static | mcp_context | tool_output | manual_review_required` (per Phase 1 §5, NOT FPP §10).
- `Finding.blast_radius` enum exactly: `secrets | user_data | tenant_data | admin_access | financial_data | private_files | availability | unknown`.
- Expected-failure paths return `Result<T, E>` from `src/types/result.ts`. Reserve `throw` for unexpected failures.
- `src/types/active-validation.ts` MUST stay empty in Phase 1. Adding type definitions there without a Phase 2 plan is premature abstraction.

## References

- `PHASE_1_PLAN.md` §4.0 (Agent Runtime Architecture), §5 (Finding model), §7 Task 2
- `FINAL_PRODUCT_PLAN.md` §9.3 (Control cards)
- `CLAUDE.md` §TypeScript conventions
- existing: `src/types/result.ts`
