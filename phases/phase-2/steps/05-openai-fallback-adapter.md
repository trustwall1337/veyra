# Step 05 — Superseded by step 04 (post AI-first revision)

> **This step is superseded.** After the AI-first revision (2026-05-24)
> narrowed Phase 2 step 04 from "AI provider interface + Anthropic
> adapter" to "OpenAI fallback adapter only" (because the interface and
> the Anthropic adapter moved to Phase 1 revision steps 02c and 02d
> respectively), step 04 now owns the OpenAI fallback work that this
> step originally specified.
>
> No new code lands in this step. File retained for traceability so
> existing `phases/phase-2/steps/README.md` references and any older
> manifests do not break.
>
> **Go to** `phases/phase-2/steps/04-ai-provider-interface-and-anthropic-adapter.md`
> for the active OpenAI fallback adapter step.

**Status:** superseded
**Supersedes:** none
**Superseded by:** `04-ai-provider-interface-and-anthropic-adapter.md`
**Produces:** nothing — pointer only
**Depends on:** n/a
**Executed by:** n/a
**Verification:** n/a

## Why superseded

Before the AI-first revision, Phase 2 owned both the `AiProvider` interface and the Anthropic adapter (as one step 04) plus the OpenAI fallback (this step). The revision moved `AiProvider` and Anthropic into Phase 1 deliverables because Phase 1 now has two AI agents (AI Product-Understanding and AI Inference) that need a working provider before Phase 2 even starts. That left step 04 with only the OpenAI fallback work, which is exactly what this step originally specified — so step 04 absorbed the content and this step retires.

## What you would do if you saw a future request to revive this step

Re-check whether Phase 1 revision steps 02c (`AiProvider` interface + sanitization) and 02d (Anthropic adapter) actually landed and ship the interface correctly. If they did, this step stays superseded. If they did not, the right fix is to repair the Phase 1 steps, not revive this one.

## References

- `phases/phase-2/steps/04-ai-provider-interface-and-anthropic-adapter.md` (the active OpenAI fallback step)
- `phases/phase-1/steps/02c-ai-provider-types-and-sanitization.md` (where the interface lives)
- `phases/phase-1/steps/02d-anthropic-adapter.md` (where Anthropic lives)
- `phases/phase-1/REVISION_AI_SHAPE.md` §14 Q5 (settles AI provider ownership)
