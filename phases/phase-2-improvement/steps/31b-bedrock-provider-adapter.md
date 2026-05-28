# Step 31b — AWS Bedrock provider adapter (loop driver default, per D4)

**Status:** done (2026-05-28) — auth (env-only), opaque ProviderId, provider + AiDriver, recorded-fixture transport, live transport stub (env-gated skip) landed; live AWS SDK wiring + a real Bedrock recording are a follow-up (needs AWS creds I do not have)
**Maps to:** `PLAN.md §H` Step 31b, `decisions.md` D4
**Phase:** 3, Cut 1
**Produces:** `src/ai/bedrock/` — a new `bedrock` provider adapter behind the existing provider-agnostic `AiProvider`/`AiDriver` interface. One folder; opaque `ProviderId`; no closed provider union (FPP §2A).
**Depends on:** 31 (the `AiDriver` interface)
**Executed by:** plain coding pass + `step-reviewer` + codex single-review + (optional) a live Bedrock smoke test gated on AWS creds in env
**Verification:** `pnpm test --run` green; tests assert: (a) the adapter authenticates via AWS SigV4/IAM from env (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` or profile) — never from argv; (b) structured tool-use output is validated (Zod) with fail-closed on malformed output; (c) `model_id` (the Bedrock model id) is recorded for the loop-trace audit; (d) no AWS credential value appears in any artifact/log/trace; (e) recorded-from-real Bedrock response fixture replays deterministically; live test skipped (not failed) when AWS env absent.

## Goal

Per D4, the agentic loop driver uses Anthropic models accessed through AWS Bedrock, not the direct Anthropic API. This is a distinct adapter (AWS auth, Bedrock Converse/`InvokeModel` surface, Bedrock model IDs) behind the same `AiProvider` interface. Bedrock becomes the default concrete loop-driver provider; the direct-Anthropic adapter (Phase 2 step 04) and OpenAI remain available adapters selectable by `ProviderId`.

## What lands

- `src/ai/bedrock/provider.ts` — implements `AiProvider`; Bedrock Converse API for Claude; prompt caching where Bedrock supports it; structured tool-use for the typed proposal union.
- `src/ai/bedrock/auth.ts` — SigV4/IAM auth from env (or AWS profile); never argv.
- Registration of the `bedrock` `ProviderId` in the provider registry; `--ai-provider bedrock` selects it; it is the default loop driver.
- Recorded Bedrock response fixture for deterministic tests; opt-in live smoke test (env-gated, `skipped_missing_env` when absent — per Phase 2 step 01 preventer 7).
- Tests per Verification.

## Done when

All Verification assertions pass. The agentic loop (Step 31) runs with the Bedrock driver against the fixture. `pnpm test` green; direct-Anthropic + OpenAI adapters unaffected.

## Guardrails

- Per CLAUDE.md §Secrets: AWS credentials env-only; never argv/artifact/log/trace. The loop-trace records `model_id`, not the credential.
- Per FPP §2A: `bedrock` is one folder + a registered opaque `ProviderId`; no `if (provider === 'bedrock')` switch in shared code.
- Per CLAUDE.md §Resolved decisions: structured output (tool-use) required; fail-closed on malformed parse (no silent default).
- Per Phase 2 step 01 preventer 7: live transport test is recorded-from-real OR env-gated-live, never mock-only.

## References

- `PLAN.md §H` Step 31b; `decisions.md` D4; Phase 2 step 04 (direct-Anthropic adapter — sibling); `src/ai/` provider interface
