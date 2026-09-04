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
rate-limited server endpoint performs type inspection and an idempotent,
Project-row-locked reservation. The reservation atomically charges storage to the Project owner
against the owner's tier (including collaborator uploads), then writes to an attempt-specific
temporary key before moving verified bytes to the canonical key. Only `ready` rows are visible.
Known-clean failures atomically delete the reservation and return its storage charge. Historical
file/image rows are backfilled once to the owning Project's storage counter; promoted deliverables
remain uncharged references. Daily upload quota acquisition has its own durable marker, so a
recovered idempotent reservation cannot bypass the limit or charge it twice. Already-completed
canonical uploads are marked during rollout because the preceding endpoint counted their quota
before the marker existed. Reviving an expired reservation rechecks the Project file cap, while rows
under deletion are never revived as uploads.

Expired upload and deletion leases are reclaimed by bounded lifecycle reconciliation before new
uploads and whenever the Files or Images workspace loads. Reconciliation deletes only the exact
canonical object and `<project UUID>/.uploads/<file UUID>/` attempt folder, verifies ambiguous
Storage outcomes, and releases charged bytes only in the matching database finalizer. Failures keep
the row and charge durable, surface a retry state, and can be safely retried.

Deletion obtains an expiring database lease before touching Storage. Concurrent deletes cannot
steal the lease, a crashed delete can be reclaimed after expiry, Storage-not-found is idempotent,
and finalization atomically removes metadata and returns charged bytes. Promoted agent deliverables
are references, so removing one deletes only its Project reference and never the underlying
deliverable object.

Applying the migration remains an operator-controlled release action. Roll out the migration and
matching application revision as one coordinated maintenance change because neither the old client
nor the new client is compatible with only half of this contract. Then run the isolated database
contract and verify signed read/upload/delete, collaborator uploads charged to the owner, duplicate idempotency keys, recovered-reservation quota acquisition, expired upload/delete
reconciliation, legacy storage-accounting backfill, concurrent deletion, and crash recovery with
two authenticated test users.

## Project and account deletion

`20260904210000_project_deletion_storage_integrity.sql` removes direct authenticated Project
deletion and replaces it with a durable, service-role-only coordinator. The coordinator:

1. locks the owned Project and fences new upload or file-delete attempts;
2. waits for live file-operation leases, validates owned file/image paths against the exact Project
   folder, preserves promoted agent-deliverable references, and deletes only the Project folder
   through the Storage API in bounded batches;
3. confirms the folder is empty, releases charged bytes, and deletes relational metadata in one
   database finalization transaction; and
4. leaves the Project plus a retryable job when listing, removal, lease renewal, or finalization
   fails.

A repeated delete is idempotent. Account deletion runs the same coordinator for every owned
Project before deleting the auth user. Collaborations merely joined by the departing user are not
deleted. A failed account attempt keeps the auth user active and may already have permanently
deleted earlier owned Projects; retrying resumes from the durable job state.

After a deletion request is recorded, Project summaries and details expose that durable state.
The workspace becomes read-only at the database boundary; the owner gets a bounded retry action,
while other members are told that only the owner can resume cleanup. The Project stays visible
until both Storage cleanup and relational finalization succeed.

Production rollout must apply `20260904200000` before `20260904210000`. In staging, interrupt one
multi-object Project cleanup, confirm the Project remains visible, retry it, and verify that:

- the exact `<project UUID>/` Storage prefix is empty while a prefix-collision Project is untouched;
- `project_files`, Project metadata, and charged bytes finalize only after Storage removal;
- an editor cannot delete a Project and file operations cannot start after deletion is claimed;
- deleting an account with owned Projects leaves no owned Project prefix; and
- the source revision and migration manifest match the deployed release.

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
