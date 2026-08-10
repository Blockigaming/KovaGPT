# Azure staging validation checkpoint

Checkpoint date: 2026-08-10

This record applies only to draft PR #159 and branch `infra/azure-low-cost-staging`.

## Completed without Azure access

- Repository-supported files were formatted with the locked Node/npm/Prettier toolchain.
- `scripts/azure/validate-staging-template.mjs` passed before the browser-configuration correction.
- `tests/unit/azure-staging-template.test.mjs` passed before the browser-configuration correction.
- The template now omits runtime `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` because those variables cannot retarget an already-built Vite browser bundle.
- The structural validator rejects any reintroduction of runtime `VITE_SUPABASE_*` entries.
- The immutable image input now explicitly requires a build verified against the synthetic staging browser Supabase configuration.
- The deployment runbook requires source SHA, image digest, and browser Supabase project ref provenance together.
- Issue #164 tracks a separately reviewed runtime-public-config alternative.
- No deployment command ran.
- No Azure identity, subscription token, Key Vault value, OpenAI key, Supabase key, or user data was accessed.
- No Azure or Supabase resource changed.

## Verification currently required on the corrected head

The browser-configuration correction changed the Bicep template, validator, tests, and runbook. Do not rely on the earlier focused test result for the new head.

The exact corrected commit must still pass:

```bash
node scripts/azure/validate-staging-template.mjs
node --test tests/unit/azure-staging-template.test.mjs
az bicep build --file infra/azure/staging/main.bicep --stdout >/dev/null
```

## Still required before any deployment

1. Complete the corrected-head validation commands above.
2. Supply only an immutable ACR `repository@sha256:digest` reference.
3. Prove the image browser bundle was built with the synthetic staging Supabase project.
4. Prove the browser bundle contains neither the production project ref nor the Auth rehearsal project ref.
5. Use the same synthetic Supabase URL and publishable key for the server runtime.
6. Review a full `az deployment group what-if` result.
7. Keep both generation switches disabled.
8. Obtain explicit owner approval before the guarded deployment command.

A passing GitHub check does not authorize deployment. Production, DNS, real users, and Auth migration remain separate gates.
