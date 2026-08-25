# KovaGPT final release and rollback runbook

The authoritative Day 16 release procedure is split into:

- `docs/day16/README.md`
- `docs/day16/azure-production-runbook.md`
- `docs/day16/cloudflare-edge-only.md`
- `docs/day16/supabase-backup-recovery.md`
- `docs/day16/final-release-evidence.md`

The production runtime is Microsoft Azure Container Apps. Cloudflare is DNS/proxy/security only. Supabase owns auth/database/storage. Azure managed identity accesses the approved Azure OpenAI-compatible deployments, with `gpt-5.6-sol` as KovaGPT's highest logical model. Lovable has no active role.

Run local validation before deployment, deploy only an immutable ACR digest from a clean exact SHA, preserve rollback evidence, and declare completion only after live production verification.

## Guarded Supabase migration inputs

Remote Supabase migration and reconciliation operations are intentionally fail-closed. Before any guarded remote migration is run, explicitly provide and verify the following deployment inputs:

- `SUPABASE_PROJECT_REF`: the exact target Supabase project reference.
- `SUPABASE_ACCESS_TOKEN`: the authenticated CLI access token used only by the local Supabase CLI process.
- `SUPABASE_DB_PASSWORD`: the target project's database password when required by the migration command.
- `KOVA_EXPECTED_SUPABASE_PROJECT_REF`: the independently expected production project reference used to prevent accidental targeting of the wrong backend.
- `VITE_SUPABASE_URL`: must resolve to the same expected project reference.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the browser-safe publishable key for the same expected project.

The migration tooling must explicitly link the requested `SUPABASE_PROJECT_REF`, verify it against the expected production project identity, and stop before applying remote changes if the identities do not match. Production migrations must never infer a target from an already-linked local CLI state.
The local deploy and rollback entrypoints are `npm run azure:production:deploy` and `npm run azure:production:rollback -- <deployment-evidence>`.

### Exact guarded remote migration invocation

For an intentional guarded remote migration, explicitly provide the verified target Supabase project reference in the invocation:

```bash
SUPABASE_PROJECT_REF=<exact-project-ref> npm run db:migrate
```

Replace `<exact-project-ref>` with the independently verified target project reference. The migration tooling must fail closed if the requested target does not match the expected deployment identity.
