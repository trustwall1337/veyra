# Veyra

> Security readiness for AI-built SaaS apps.

Veyra helps teams verify whether important product-security controls are
present, testable, and evidenced before an app is exposed to real users.

The first focus is **Lovable + Supabase** applications, especially risks around
authentication, authorization, tenant isolation, Supabase RLS, storage access,
secrets, dependencies, and missing negative tests.

## Name

**Veyra** suggests verification, evidence, and readiness without locking the
product to one stack, vendor, or deployment model.

## Trust Model

Veyra should not claim that an application is "secure," "safe," or
"compliant." It should report which controls were checked, which evidence was
found, which evidence was missing, and which areas need human review.

Veyra should not mutate production systems, change permissions, exfiltrate data,
auto-merge fixes, or make final security decisions.

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
```
