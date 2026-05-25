# Step 12 — Reporter: active-validation + cleanup-proof + AI sections

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 10`, §9 (allowed language), §11.4 (Sources section)
**Produces:** reporter extension (`src/reporters/markdown/evidence/`, `src/reporters/markdown/sections/`)
**Depends on:** 10e
**Executed by:** plain coding pass (+ `output-language-lint`)
**Verification:** snapshot tests with property serializers; `output-language-lint` zero hits; Sources section enumerates `scan-actions.log` summary counts

## Goal

Replace the Phase 1 step 13 placeholders. Render `active_validation` and `cleanup_proof` evidence kinds. Add the AI-enrichments section with a distinct heading from deterministic findings.

## What lands

- Replace `src/reporters/markdown/evidence/active-validation.ts` placeholder with full renderer: per-test outcome, sanitized test parameters (synthetic identity ids only — no JWTs, no service-role key), assertion details, duration.
- Replace `src/reporters/markdown/evidence/cleanup-proof.ts` placeholder: residual count, deleted count, per-resource log summary. Heading: "Sandbox cleanup."
- New `src/reporters/markdown/sections/ai-enrichments.ts`: renders `ai-enrichments.json` distinctly from deterministic findings. Low-confidence outputs under a distinct "AI-suggested (low confidence)" subheading per `§10.5`.
- New `src/reporters/markdown/sections/ai-concerns.ts`: renders `ai-concerns.json` (the `AIConcern` artifact from the AI-first revision). **Visibility is governed by a single CLI flag**, `--ai-concern-threshold low|medium|high` (default `medium`):
  - `confidence >= threshold` → rendered under the heading "AI-suggested areas for human review."
  - `confidence < threshold` → recorded in `ai-concerns.json` (audit trail) but NOT rendered. Setting `low` shows everything; setting `high` shows only high-confidence entries.
  - When `--no-ai` is set, the entire AIConcerns section is omitted; a one-line note in the Sources section says "AI was disabled for this scan; AIConcerns not produced."
  - There is no separate hide-low flag — the threshold is the only visibility control.
- Extend `src/reporters/markdown/sections/sources.ts` (Phase 1 step 13) to render `scan-actions.log` summary: counts per action type (ai_call, supabase_admin_call, scanner_invocation, mcp_call, executor_action), per-scanner success/missing, MCP connectors enabled, `ValidationPolicy` summary, AI model id + version, cache hit ratio.
- New allowed-claims vocabulary entries: "actively tested," "proven in sandbox under scenario X," "AI-suggested explanation; needs human review." Update `src/reporters/markdown/strings.ts`.
- Snapshot serializers for non-deterministic fields: `scan_id` (UUID), timestamps, `request_fingerprint` (SHA-256), `synthetic_data_refs` (UUIDs). Scrub these from snapshot output so Mode B reports are diff-stable.

## Done when

- A Mode B fixture run renders a stable `veyra-report.md` with:
  - Deterministic findings under their existing Phase 1 section
  - Active-validation outcomes under "Active validation results"
  - Cleanup proof under "Sandbox cleanup"
  - AI enrichments under "AI-suggested explanations" (with low-confidence subsection if any)
- `output-language-lint` returns zero hits on the rendered report and on every string in `strings.ts`.
- Snapshot tests pass on a Mode B fixture run; re-run produces byte-identical output after serializers scrub non-deterministic fields.
- `--no-ai` run produces a report with the AI section explicitly noted as "no AI provider configured" — not a missing section.
- The Sources section explicitly lists scanners run / missing / disabled MCP and the resulting coverage gaps per `control_id`.

## Guardrails

- Per `§9` (Phase 1 + Phase 2 extensions): every string passes language lint. Allowed-claims vocabulary only.
- Per `§10.5`: AI outputs with `confidence: 'low'` render under a distinct subheading, never mixed with high-confidence enrichments.
- Per `§9` Phase 2 additions: rendering distinguishes scenario-level from control-level claims. Per-scenario `proven_denial` renders as "this specific scenario was denied" (note the singular). `proven_in_sandbox` (a readiness state on the whole control card, not on individual scenarios) renders as "all required scenarios for this control were denied in this sandbox run." Never "the control is secure," never "control proven," never any phrasing that implies generality beyond the scenarios actually tested.
- Per `§11.4`: `scan-actions.log` is rendered as a summary (counts), not the full log. The full log is a separate artifact.
- Per `FPP §2A` rule 6: renderers are registered per-`EvidenceKind`, not per-connector. Adding a new connector does not require editing any renderer.
- Code-snippet rendering still redacts secret-like patterns per Phase 1 step 13.

## References

- `PHASE_2_PLAN.md` §9 (non-claims, allowed language), §10.5 (confidence rendering), §11.4 (auditability)
- Phase 1 step 13 (placeholder renderers)
- Phase 1 step 02 `EvidenceKind` discriminated union
- `.claude/agents/output-language-lint.md`
