# Example: well-written Veyra finding

A finding Veyra should produce when it observes a public Supabase storage
bucket that appears to hold user- or tenant-scoped resources.

---

```yaml
id: supabase-storage-public-bucket-private-data
title: Public storage bucket appears to hold tenant- or user-scoped resources
classification: likely_issue
evidence_strength: medium
reproducibility: static
review_action: review_before_launch
blast_radius: private_files
evidence:
  - kind: schema
    ref: supabase/schema.sql:142
    quote: |
      create policy "public read" on storage.objects
        for select using (bucket_id = 'user-uploads');
  - kind: file
    ref: src/app/api/upload/route.ts:18
    quote: |
      const { data } = await supabase.storage
        .from('user-uploads')
        .upload(`${user.id}/${file.name}`, file);
suggested_tests:
  - "Negative test: anonymous client downloads /storage/user-uploads/<other-user-id>/<file>. Expect 403."
  - "Negative test: authenticated user A downloads /storage/user-uploads/<user-B-id>/<file>. Expect 403."
uncertainty_notes: |
  The bucket is configured as public-readable and the upload path includes a
  user ID, which together suggest user-scoped files in a public bucket. The
  bucket may instead be intentionally public (e.g. avatars). Adding the two
  negative tests above would resolve which case applies.
remediation_hint: |
  Review whether 'user-uploads' should be public-readable. If files are
  user-scoped, consider scoping the bucket policy to the file owner.
ai_enriched: false
```

## What this finding does right

1. **Title is neutral.** "Public storage bucket appears to hold tenant- or user-scoped resources" describes what was observed. It does not say "vulnerable," "exploitable," or assign a severity label.
2. **Classification is `likely_issue`, not `confirmed_issue`.** The evidence is strong but circumstantial — the bucket could be intentionally public. Picking the less severe option is correct when uncertain.
3. **Two pieces of evidence, both file-referenced with verbatim quotes.** A reviewer can navigate to each.
4. **Two specific negative tests.** Both are runnable; both would resolve the uncertainty noted above.
5. **`uncertainty_notes` explains what is unknown** and what evidence would resolve it.
6. **`remediation_hint` uses directional language** ("review whether," "consider"). It does not say "do X to fix this."
7. **`blast_radius: private_files`** is set precisely — not `unknown` (the bucket contents are scoped), not `user_data` (which refers to database rows).
8. **No forbidden words.** No "secure," "vulnerable," "exploitable," "compliant," and no compliance framework names.
9. **`review_action: review_before_launch`** — appropriate for a likely_issue. `fix_before_launch` would be premature.
