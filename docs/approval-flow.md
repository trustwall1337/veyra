# Mode B approval flow

Phase 2 active validation runs against a customer-owned sandbox.
Veyra refuses to start without an explicit human approval — either
interactive (ad-hoc runs) or via a signed approval file (CI). This
page documents the approval contract.

## Interactive flow (ad-hoc)

```bash
pnpm dev -- scan \
  --project ./app \
  --supabase-sandbox aukqmgjnoldnhrvsolhh \
  --supabase-service-role-key VEYRA_TEST_SRK \
  --mode sandbox_active_validation \
  --approve-active
```

When the scan reaches the Synthesize phase, Veyra prompts:

```
This run will create synthetic users + tenants + records in the
sandbox Supabase project `aukqmgjnoldnhrvsolhh`. Type the exact
phrase below to proceed, or anything else to abort:

  yes-i-understand-this-mutates-sandbox

> _
```

Only the exact phrase proceeds. Any other input aborts before
Synthesize begins.

## CI flow

CI runs cannot prompt. Pass a signed approval file:

```bash
pnpm dev -- scan \
  --project ./app \
  --supabase-sandbox aukqmgjnoldnhrvsolhh \
  --supabase-service-role-key VEYRA_TEST_SRK \
  --mode sandbox_active_validation \
  --ci \
  --approval-file ./veyra-approval.json
```

Approval-file format (step 2.01 decision 5 Option A — JSON +
minisign signature):

```json
{
  "scan_id_prefix": "veyra-",
  "granted_at": "2026-05-26T00:00:00Z",
  "granted_by": "release-manager@example.invalid",
  "scope": {
    "project_ref": "aukqmgjnoldnhrvsolhh",
    "max_synthetic_records": 100,
    "expires_at": "2026-06-26T00:00:00Z",
    "max_scans": 10
  },
  "signature": "<base64 minisign signature>"
}
```

## Gates the parser checks

- `scope.project_ref` must match `--supabase-sandbox`. (Enforced.)
- `scope.expires_at` must be in the future. (Enforced.)
- `<approval-file>.usage.json` counter file (lives next to the
  approval file) must show `scans_consumed < scope.max_scans`.
  (Enforced.)
- Each scan increments the counter and updates `last_consumed_at`.
  (Enforced.)
- Rotating an approval = delete the counter file OR revoke the
  approval file.
- **Signature verification (Ed25519 minisign) — NOT yet enforced.**
  The approval-file parser reads the `signature` field but does not
  verify it against a trusted public key. This is a known follow-up
  (codex retro 2.11-approval-signature-not-verified) and lands with
  the specific minisign npm library pick from step 2.01 decision 5.
  Customers running Mode B before signature verify lands must treat
  the approval file as integrity-trusted on its own (e.g. ship via
  a secrets manager, not a public URL).
- **`max_synthetic_records` budget enforcement — NOT yet wired into
  the compiler.** The compiler currently checks per-scan caps from
  `SyntheticDataPolicy` but not the approval-file's
  `max_synthetic_records` against the compiled plan's record count.
  Follow-up codex retro 2.11.

## Refusals

Any of the following → non-zero exit with a structured error
naming which gate rejected:

- Approval file unreadable / malformed JSON.
- `scope.project_ref` doesn't match `--supabase-sandbox`.
- `expires_at` is in the past.
- `max_scans` reached.
- (When signature verification is wired) Bad signature.

## The service-role-key argv guard

`--supabase-service-role-key` takes the NAME of an environment
variable, NEVER the key value. The parser refuses values that look
like keys (`sk-`, `sb_`, `sbp_`, `eyJ` JWT prefix, long
high-entropy base64). The expected shape is `SHOUTY_CASE_NAME`.

CLAUDE.md §Secrets: the service-role key never appears on argv,
in `scan-actions.log` args fingerprints, in artifacts, or in any
error message. The key flows only through the env var the
manifest names.

## What's still on the follow-up list

- Signature verification: step 2.11 ships the file shape + scope/
  expiry/counter gates; the minisign npm library pick (step 2.01
  decision 5 picked the technology; library deferred) and the
  Ed25519 verify call land as a small follow-up.
- The CLI argv wiring (declaring the new flags on
  `scan-command.ts`) also lands with that follow-up — until then,
  Mode B's parse-time rejection from Phase 1 step 03 stays in
  place.
