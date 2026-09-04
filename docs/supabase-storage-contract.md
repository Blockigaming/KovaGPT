# Supabase storage and default-privilege contract

This document records the source contract introduced by
`20260902013000_storage_bucket_and_default_privilege_reconciliation.sql`. Applying that migration
to a remote project is a separate, operator-controlled release step.

## Reconciled buckets

| Bucket           | Public | Per-object limit | Allowed MIME types          | Source of contract                                                                                                                                             |
| ---------------- | ------ | ---------------: | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library-images` | No     |            8 MiB | PNG, JPEG/JPG, WebP, GIF    | `src/lib/library-images.functions.ts` validates the same limit, MIME allowlist, and file signatures.                                                           |
| `agent-evidence` | No     |           10 MiB | PNG, JPEG, plain text, JSON | `20260728090000_helios_agent_runtime.sql` superseded the original 5 MiB/PNG-only intent, but its `ON CONFLICT DO NOTHING` could not update an existing bucket. |

The migration also replaces the two historical `agent-evidence` read policies with one
authenticated, owner-folder-scoped policy. It does not add browser upload privileges.

## `project-files` rollout contract

`20260904200000_project_file_upload_integrity.sql` creates or reconciles the private
`project-files` bucket at a 10 MiB per-object limit. The application accepts signature-verified
PNG, JPEG, WebP, GIF and PDF files plus bounded UTF-8 text/code, Markdown, CSV/TSV, and valid JSON.
HTML and source code are stored as inert `text/plain`, not active browser content.

Browser roles can read only objects whose first path segment belongs to a Project they can access.
They cannot insert, update, or delete bucket objects or Project file metadata. A verified,
rate-limited server endpoint performs type inspection, quota reservation, an idempotent
project-row-locked count reservation, canonical-path upload, and durable finalization. Deletion
removes Storage first and then atomically removes metadata and returns charged bytes.

Applying the migration remains an operator-controlled release action. Before enabling the product
surface in production, apply the migration before the matching application revision, run the
isolated database contract, and verify signed read/upload/delete with two authenticated test users.

## Future-object default privileges

Future tables and sequences created by the proven migration owner `postgres` in `public` no longer
grant privileges to `PUBLIC`, `anon`, or `authenticated` by default. A migration that introduces a
browser-facing object must grant only the operations its RLS/RPC contract needs. The change is not
retroactive: existing object grants remain untouched.

Function defaults are deliberately not changed here. PostgreSQL's implicit `PUBLIC` function
`EXECUTE` default is role-global; an `IN SCHEMA public` revoke does not override it. A global revoke
would also affect future postgres-owned functions outside `public`, so that broader policy needs a
separate owner-approved review of extension and platform schemas.

Rollback is configuration-only. Restore the previous bucket rows and historical read policies if
needed, then explicitly `ALTER DEFAULT PRIVILEGES ... GRANT` only the defaults approved for future
objects. Neither applying nor reverting default privileges changes grants on existing objects.
