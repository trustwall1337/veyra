---
description: Run veyra against the local vulnerable fixture and verify expected findings appear (Phase 1 success criterion).
---

Run the veyra CLI against the bundled vulnerable fixture:

```bash
pnpm dev -- scan --project ./examples/vulnerable-lovable-supabase
```

If the CLI is still a stub (prints only the "not yet implemented" banner): report that fact and stop. Do not fabricate findings to make the run look successful.

Once scanning is implemented, verify against PHASE_1_PLAN.md §8 success criteria:

1. All 12 initial deterministic checks from §3 Step 3 are exercised:
   - Supabase service-role key pattern in client-accessible files
   - `.env` or secret-like files committed
   - RLS disabled on likely sensitive tables
   - RLS enabled but no policies
   - broad RLS policy such as `using (true)`
   - all-authenticated broad access to sensitive tables
   - public sensitive storage bucket
   - direct object lookup without obvious user/tenant filter
   - frontend-only protected route patterns
   - admin route without clear server-side role check
   - missing negative auth/RLS tests
   - secrets-in-history check
2. At least 2 intentionally seeded non-issues do NOT appear as findings (false-positive control).
3. Output uses allowed-claims phrasing only — invoke `output-language-lint` sub-agent to confirm.
4. Any reported finding that touched a secret is redacted.

Report the diff: expected vs actual. Do not modify the fixture to make findings appear.
