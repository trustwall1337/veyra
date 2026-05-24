# Example: BADLY written Veyra finding

What NOT to do. Same scenario as `good-finding.md` — a public Supabase storage
bucket holding user files — but written in a way that violates the trust
model. Inline annotations explain each violation.

---

```yaml
id: vuln-001                                                 # BAD: meaningless id
title: SQL injection vulnerability in storage upload         # BAD: wrong category, dramatic, forbidden word "vulnerability"
classification: confirmed_issue                              # BAD: overclaim — evidence is circumstantial
evidence_strength: high                                      # BAD: overclaim — would need exploit POC for "high"
reproducibility: tool_output                                 # BAD: wrong — this came from static analysis, not a tool
review_action: fix_before_launch                             # BAD: premature for a non-confirmed finding
blast_radius: unknown                                        # BAD: lazy — it is clearly private_files
evidence: []                                                 # BAD: NO evidence — must have at least one
suggested_tests: []                                          # BAD: NO tests — defeats the product's purpose
uncertainty_notes: ""                                        # BAD: missing — required when not confirmed+high
remediation_hint: |                                          # BAD: prescriptive + compliance language
  Disable public access on the bucket and re-deploy. This will fix the
  vulnerability and bring the app into SOC2 compliance.
ai_enriched: true                                            # BAD: AI-enriched without confidence note
```

## What is wrong, field by field

1. **`id: vuln-001`** — meaningless. IDs must be stable kebab-case slugs describing the check, so a reviewer reading the report knows what this is at a glance. Correct: `supabase-storage-public-bucket-private-data`.

2. **`title: SQL injection vulnerability in storage upload`** — three problems:
   - **"vulnerability"** is forbidden language. Veyra is not a vulnerability scanner.
   - **"SQL injection"** is the wrong category — this is a storage authorization issue, not an injection.
   - **Dramatic phrasing** primes readers to skip the analysis. Titles should be neutral and descriptive.

3. **`classification: confirmed_issue`** with this evidence is overclaiming. Circumstantial evidence (public bucket + user-scoped upload path) is `likely_issue` at most. The CLAUDE.md rule applies: when uncertain, pick the less severe option.

4. **`evidence_strength: high`** — "high" should imply direct, definitive evidence (e.g. a passing test that demonstrates the issue, or an exact policy contradiction). Heuristic correlation is `medium` at best.

5. **`reproducibility: tool_output`** — wrong. Nothing was reproduced; this came from static reading of the schema and upload code. Should be `static` or `manual_review_required`.

6. **`review_action: fix_before_launch`** — premature for a `likely_issue`. The correct action is `review_before_launch`, which prompts the human reviewer to decide.

7. **`blast_radius: unknown`** — lazy. The blast radius here is `private_files`. Reserve `unknown` for cases where you genuinely cannot tell.

8. **`evidence: []`** — a finding with no evidence is not a finding. If you have no evidence, the classification is `missing_evidence`, and the body explains what evidence you looked for and didn't find.

9. **`suggested_tests: []`** — the entire Veyra value proposition is "tell developers what to test before launch." A finding without suggested tests fails the product's purpose.

10. **`uncertainty_notes: ""`** — required for everything except `confirmed_issue` with `evidence_strength: high`. Without uncertainty notes, the reviewer cannot tell what the finding *doesn't* know.

11. **`remediation_hint`** has two violations:
    - **"This will fix the vulnerability"** — prescriptive, and "vulnerability" is forbidden. Replace with directional language ("consider scoping the bucket policy to the file owner").
    - **"bring the app into SOC2 compliance"** — compliance framework name is forbidden. Veyra never claims compliance status. Even mentioning SOC2 in remediation implies Veyra checked SOC2 controls, which it doesn't.

12. **`ai_enriched: true`** without a confidence note — AI-enriched findings must include explicit confidence and uncertainty markers per FINAL_PRODUCT_PLAN §12.

## Recognizing this pattern in your own drafts

Every violation above shares one root cause: the writer is acting like a vulnerability scanner instead of like Veyra. The fix is not to soften the words — it's to **drop a classification level**. `likely_issue` with directional remediation and runnable tests is more useful than `confirmed_issue` with prescriptive compliance language.
