# Azure staging validation checkpoint

Checkpoint date: 2026-08-10

This record applies only to draft PR #159 and branch `infra/azure-low-cost-staging`.

## Completed without Azure access

- Repository-supported files were formatted with the locked Node/npm/Prettier toolchain.
- `scripts/azure/validate-staging-template.mjs` passed.
- `tests/unit/azure-staging-template.test.mjs` passed.
- The temporary formatting workflow removed itself.
- The net PR contains only the five reviewed infrastructure, validation, test, and documentation files.
- No deployment command ran.
- No Azure identity, subscription token, Key Vault value, OpenAI key, Supabase key, or user data was accessed.
- No Azure or Supabase resource changed.

## Still required before any deployment

1. Run `az bicep build --file infra/azure/staging/main.bicep --stdout` in an approved Azure CLI environment.
2. Run the focused Node validator and tests from the exact reviewed commit.
3. Supply only an immutable ACR `repository@sha256:digest` reference.
4. Use a synthetic staging Supabase project, never production or the Auth rehearsal destination.
5. Review a full `az deployment group what-if` result.
6. Keep both generation switches disabled.
7. Obtain explicit owner approval before the guarded deployment command.

A passing GitHub check does not authorize deployment. Production, DNS, real users, and Auth migration remain separate gates.
