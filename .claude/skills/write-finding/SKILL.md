---
name: write-finding
description: Use when drafting, generating, or formatting a Veyra finding, launch-blocker, control card, or readiness-report entry. Enforces the allowed-claims vocabulary from PHASE_1_PLAN §9, the classification system from §5, and the finding structure from FINAL_PRODUCT_PLAN §10. Do NOT use for code that processes findings or for unrelated documentation.
---

# Skill: write-finding

Produce a Veyra finding using the exact trust-model vocabulary. The product's promise depends on this language being correct — see CLAUDE.md §Output language, PHASE_1_PLAN §9, FINAL_PRODUCT_PLAN §10.

## When to use

User asks to:

- "draft / write / generate a finding"
- "write the launch-blocker for [X]"
- "format this evidence as a finding"
- "write the control card for [X]"
- "draft the readiness-report section for [X]"

Do NOT use when:

- writing code that *processes* findings (that's normal coding)
- writing unrelated docs (CLAUDE.md, README, code comments not in reports)

## Allowed vocabulary — quoted verbatim from PHASE_1_PLAN §9

Veyra Phase 1 may claim:

- "these controls were checked"
- "this evidence was found"
- "this evidence was missing"
- "these issues appear launch-blocking"
- "these areas need human review"
- "these negative tests should be added"

Veyra Phase 1 may NOT claim:

- the application is secure
- authorization is fully proven
- compliance is achieved
- production is safe to scan
- AI findings are final authority
- scanner silence means no vulnerability exists

## Forbidden vocabulary

Never use any of:

- "secure," "safe," "compliant," "hardened," "protected"
- "exploitable," "vulnerability confirmed," "weaponizable"
- "SOC2," "GDPR," "ISO 27001," "PCI," "HIPAA," "NIS2," "DORA," or any other compliance framework name
- pentester language: "popped," "owned," "P0/P1/P2," "RCE," "0-day"
- silence-as-safety: "no vulnerabilities," "all clear," "passed"

If you find yourself reaching for a forbidden word, the problem is usually that you're overclaiming. Drop a classification level (`confirmed_issue` → `likely_issue`, `likely_issue` → `missing_evidence`) instead of softening the verb.

## Classification system (PHASE_1_PLAN §5, FINAL_PRODUCT_PLAN §10)

Pick exactly one:

- **`confirmed_issue`** — direct evidence in code, config, or tests. Quote the exact lines.
- **`likely_issue`** — strong heuristic match, but missing one piece of confirming evidence. State what evidence would upgrade it to confirmed.
- **`missing_evidence`** — control should exist; no evidence found either way. Not the same as "broken."
- **`coverage_gap`** — the check itself couldn't run (scanner not installed, file unreadable, type unsupported). Not a security claim.
- **`informational`** — observation that affects review effort but isn't itself launch-blocking.

If you can't pick confidently between two, pick the **less severe** one.

## Required finding fields (FINAL_PRODUCT_PLAN §10 + PHASE_1_PLAN §5)

```yaml
id: string                       # stable, kebab-case, e.g. supabase-rls-disabled
title: string                    # short, neutral. Not "VULN: SQL injection"
classification:                  # one of: confirmed_issue | likely_issue | missing_evidence | coverage_gap | informational
evidence_strength: low | medium | high
reproducibility: static | mcp_context | tool_output | manual_review_required
review_action: fix_before_launch | review_before_launch | add_test | monitor | accept_with_owner
blast_radius: secrets | user_data | tenant_data | admin_access | financial_data | private_files | availability | unknown
evidence:                        # at least one entry, or classification is missing_evidence
  - kind: file | scanner_output | mcp_response | schema | test
    ref: string                  # file:line, scanner finding id, etc.
    quote: string                # short verbatim excerpt; REDACT any secret values
suggested_tests: []              # at least one negative test
uncertainty_notes: string        # what isn't known; what would resolve it
remediation_hint: string         # direction only — NOT a fix recipe
```

Hard requirements:

- At least one `evidence` entry. If you can't provide one, the classification is `missing_evidence`.
- At least one `suggested_tests` entry. The product's value proposition is "what to test before launch."
- `uncertainty_notes` is required for everything except `confirmed_issue` with `evidence_strength: high`.
- `remediation_hint` is direction, not prescription. Use phrasing like "review whether..." or "consider..." — never "do X to fix this."
- AI-generated portions explicitly labeled `ai_enriched: true` and include a confidence note.

## Worked examples — read both before drafting

- `examples/good-finding.md` — a finding for a public Supabase storage bucket, written correctly.
- `examples/bad-finding.md` — the same scenario written badly, with inline annotations explaining each rule violation.

The bad example shows the most common failure modes: overclaiming, compliance language, missing evidence, prescriptive remediation. Read it to recognize what to avoid.

## Before you finish — checklist

- [ ] No forbidden words anywhere — grep the draft for: `secure`, `safe`, `compliant`, `hardened`, `exploitable`, `vulnerability`, `SOC2`, `GDPR`, `PCI`, `HIPAA`, `NIS2`, `DORA`, `ISO 27001`, `popped`, `owned`, `RCE`, `0-day`, `all clear`, `passed`
- [ ] Only allowed-claim verbs in claim sentences: `checked`, `found`, `missing`, `appears`, `need`, `should`
- [ ] Classification picked; less-severe option chosen when uncertain
- [ ] At least one `evidence` entry (or classification is `missing_evidence`)
- [ ] Evidence quotes redact any secret-like content
- [ ] At least one `suggested_tests` entry
- [ ] `uncertainty_notes` present unless `confirmed_issue` + `evidence_strength: high`
- [ ] `remediation_hint` is direction, not prescription
- [ ] `blast_radius` set (use `unknown` only when genuinely unknown — don't guess)
- [ ] AI-generated portions explicitly labeled
- [ ] Title is neutral — describes what was observed, not its severity or category
