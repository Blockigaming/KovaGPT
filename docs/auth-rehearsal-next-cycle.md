# Auth Migration Rehearsal V2 — next controlled cycle

This runbook is scoped only to the disposable rehearsal resources.

## Immutable source

Branch: `fix/auth-rehearsal-safe-diagnostics`

Current reviewed diagnostic commit: `15329aa3b44f828d1aadb6d62fed08e390b6781b`

Base V2 commit: `beaa7bb3de70c443f25617880dc23308308ce766`

Do not merge this branch to `main` as part of the rehearsal.

## Current verified infrastructure state

- Azure Container App: `ca-kovagpt-auth-rehearsal`
- Resource group: `rg-kovagpt-dev`
- Rehearsal Supabase ref: `oztdrjtdglkizlewnulh`
- Real NEW Supabase ref `mfbycmbjygcfkrsuepxf` remains prohibited.
- Destination `auth.users = 0` and `auth.identities = 0` after the failed signed attempt.
- Session-pooler credentials and PostgreSQL connectivity were independently verified with `psql`.
- Ingress was disabled after the failed signed attempt.
- Live FK is `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`.

## Why the diagnostic is needed

The deployed V2 route returns the generic `rehearsal_failed` only for an unknown/raw exception. `importRehearsal()` converts its database-operation failures to `RehearsalError`, while `client.connect()` was previously outside such a wrapper. The diagnostic branch therefore maps a raw `pg` connect failure to `database_connect_failed` without returning exception details.

## Build only

Use the repository workflow `.github/workflows/build-auth-rehearsal-image.yml` with the exact reviewed SHA as `source_ref`.

The workflow must only build and push. Do not deploy production or change `main`.

## Deployment gates

Before deploying a new rehearsal image:

1. Confirm `auth.users = 0` and `auth.identities = 0`.
2. Confirm `ca-kovagpt-auth-rehearsal` ingress is disabled.
3. Confirm min/max replicas remain exactly `1/1`.
4. Confirm the image digest belongs to the reviewed diagnostic SHA.
5. Keep `AI_GENERATION_ENABLED=false`.
6. Preserve the existing rehearsal-only database URL and HMAC secret references.

## Single diagnostic retry

After the reviewed image is deployed and healthy:

1. Enable external ingress only on `ca-kovagpt-auth-rehearsal`, target port 3000, HTTPS only.
2. Confirm `/api/health` returns 200.
3. Send exactly one freshly timestamped, freshly nonced, HMAC-signed synthetic request.
4. Do not reuse a nonce.
5. Immediately inspect the response.

Interpretation:

- `database_connect_failed`: diagnose Node `pg` TLS/certificate configuration. Do not weaken certificate verification as the final fix. Prefer supplying the Supabase project/server CA certificate and keeping verification enabled.
- `schema_contract_mismatch`: patch the known `information_schema.constraint_column_usage` FK metadata fragility using authoritative PostgreSQL catalog metadata (`pg_constraint`, `pg_class`, `pg_namespace`, `pg_attribute`) while preserving the exact FK requirement.
- `database_operation_failed`: add a second safe, allowlisted transaction-stage diagnostic before changing infrastructure.
- success (`status: ok`): verify destination evidence, then immediately disable ingress.

## TLS policy if `database_connect_failed` is confirmed

Do not permanently change the receiver to `rejectUnauthorized: false` merely to make the rehearsal pass.

The preferred secure fix is:

- obtain the Supabase database/server root CA certificate for the disposable rehearsal project;
- provide it to the Container App as a secret/file or other server-only trusted configuration;
- configure `pg` with `ssl: { ca: <trusted CA>, rejectUnauthorized: true }`;
- keep the connection string free of `sslmode`, `sslrootcert`, `sslcert`, and `sslkey` parameters so node-postgres does not overwrite the explicit `ssl` object;
- add tests that no CA contents or connection details can reach responses/logs.

## Final success evidence

For the one-user/one-email-identity synthetic fixture, success must be followed by direct destination verification. Never infer success solely from HTTP status.

After success:

- query `auth.users` and `auth.identities` counts;
- verify the expected UUID/provider evidence;
- verify no orphan identity and no duplicate `(provider, provider_id)`;
- disable ingress immediately;
- preserve response/evidence without secrets or PII;
- do not merge to `main` until the migration design review explicitly approves it.
