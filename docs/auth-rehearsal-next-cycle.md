# Auth Migration Rehearsal V2 — next controlled cycle

This runbook is scoped only to the disposable rehearsal resources.

## Immutable source

Branch: `fix/auth-rehearsal-safe-diagnostics`

Current reviewed hardening commit: `0d844a535d917646e5a1917e11c5fe36723149c3`

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
- Live provider-subject uniqueness is one composite constraint over `provider_id` and `provider`.

## Hardening now present on the branch

The branch now addresses both confirmed weak points without changing the existing importer transaction or payload protocol:

1. A raw `pg` connection error is mapped to `database_connect_failed` without exposing raw error details.
2. PostgreSQL TLS verification remains enabled with `rejectUnauthorized: true`.
3. Optional server-only `AUTH_MIGRATION_REHEARSAL_DATABASE_CA` PEM material can be supplied to `pg`.
4. Database connection attempts have a 10-second timeout.
5. Database-close failures log only a fixed `database_close` stage.
6. The connected `pg` client is wrapped by `auth-migration-rehearsal-db-adapter.server.mjs` before `importRehearsal()` runs.
7. Only the fragile legacy constraint-metadata query is replaced. All other SQL is passed through unchanged.
8. Authoritative constraint discovery uses read-only `pg_catalog.pg_constraint`, `pg_class`, `pg_namespace`, and `pg_attribute` metadata.
9. The adapter fails closed unless it proves:
   - `auth.users(id)` is a primary key;
   - `auth.identities(id)` is a primary key;
   - `auth.identities.user_id` references `auth.users.id`;
   - that FK has `ON DELETE CASCADE`;
   - one composite unique constraint contains exactly `provider` and `provider_id`.
10. Existing HMAC, nonce/replay, destination-affinity, generated-column, empty-destination, transaction, rollback, evidence, and one-shot behavior remains in the original importer.

## Build only

Build only from the exact reviewed head commit. The repository workflow `.github/workflows/build-auth-rehearsal-image.yml` is designed to build and push the disposable rehearsal image and must not deploy production or change `main`.

Before building, re-read PR #139 and confirm its head SHA still matches this runbook. If the branch head moved, treat the new SHA as unreviewed until its diff is inspected.

## CA configuration gate

The route can use `AUTH_MIGRATION_REHEARSAL_DATABASE_CA` as server-only PEM material while keeping strict TLS verification enabled.

If the existing system trust store still produces `database_connect_failed`, obtain the Supabase database/server root CA certificate for only the disposable rehearsal project and store it as an Azure Container App secret. Map that secret only to:

`AUTH_MIGRATION_REHEARSAL_DATABASE_CA`

Never put CA contents in the database URL, client response, logs, or browser-visible configuration.

Do not use `rejectUnauthorized: false` and do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Deployment gates

Before deploying a new rehearsal image:

1. Confirm `auth.users = 0` and `auth.identities = 0`.
2. Confirm `ca-kovagpt-auth-rehearsal` ingress is disabled.
3. Confirm min/max replicas remain exactly `1/1`.
4. Confirm the image digest belongs to the exact reviewed hardening SHA.
5. Keep `AI_GENERATION_ENABLED=false`.
6. Preserve the existing rehearsal-only database URL and HMAC secret references.
7. Confirm no environment value references the prohibited real project `mfbycmbjygcfkrsuepxf`.
8. Do not modify `ca-kovagpt-dev`.

## Single synthetic retry

After the reviewed image is deployed and healthy:

1. Enable external ingress only on `ca-kovagpt-auth-rehearsal`, target port 3000, HTTPS only.
2. Confirm `/api/health` returns 200.
3. Confirm destination counts are still `0 / 0`.
4. Send exactly one freshly timestamped, freshly nonced, HMAC-signed synthetic request.
5. Do not reuse a nonce.
6. Immediately inspect the response.

Interpretation:

- `database_connect_failed`: the request passed authentication/payload gates but Node `pg` could not connect. Configure/verify the trusted Supabase CA rather than weakening TLS.
- `schema_contract_mismatch`: the connected database failed strict schema/constraint verification. Do not alter Supabase schema until the exact mismatch is identified.
- `database_operation_failed`: a raw transaction-stage database operation failed and should have rolled back; capture only safe stage evidence before changing infrastructure.
- `destination_not_empty`: stop immediately and identify the rows before any cleanup.
- `post_insert_verification_failed`: verify destination rolled back to `0 / 0` before any retry.
- success (`status: ok`): verify destination evidence directly and then immediately disable ingress.

## Final success evidence

For the one-user/one-email-identity synthetic fixture, expected evidence is:

- users: `1`
- identities: `1`
- provider distribution: `{ "email": 1, "google": 0 }`
- user UUID fingerprint: `5b7095dff329bac5840a31c433e78f27`
- identity fingerprint: `e4a5dddad210d0c9e0b74531f4a52a72`

Never infer success solely from HTTP status.

After success:

- query `auth.users` and `auth.identities` counts;
- verify the expected UUID/provider evidence;
- verify no orphan identity and no duplicate `(provider, provider_id)`;
- disable ingress immediately;
- preserve response/evidence without secrets or PII;
- do not merge to `main` until the migration design review explicitly approves it.
