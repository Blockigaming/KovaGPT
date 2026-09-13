# Retained Project source transfer

Account deletion preserves Project source bytes that already have independently verified, live collaborator Work or Project references. A legacy object uploaded with a user JWT must first leave that Auth owner; Supabase refuses to delete users who still own Storage objects.

The service-only transfer uses the Storage SDK `copy` API. Supabase documents that a resource created with a service key has no `owner_id`. Publication independently verifies that the destination actually has no Auth owner, rather than trusting a successful copy response.

1. Under the account and source-path locks, require the durable deletion fence, exact Storage owner, and trusted Work access or completed promotion provenance. Reserve a fresh destination and a pending generic artifact generation before any external copy. Retire the old path against new references.
2. Issue at most one copy for that generation. Verify equal SHA-256 digests of the bounded source and destination bytes. A copy error, timeout, or ambiguous response never triggers another write to that path.
3. Publish in one database transaction only while the generation lease remains pending. Check the source object ID/version, destination ID/version and owner, current reference provenance, and other account/Project deletion fences. Rebind surviving Work, Project, and exact completed Library promotion references. Move retained charge paths without changing their amounts.
4. The normal source cleanup can then remove the old object through the Storage API. A retry observes the published mapping and does not copy or charge again.

Uncertain attempts expire after three minutes. A retry reserves another generation and permanently retires the old destination. The generic artifact sweep repeatedly removes retired paths, including a copy that commits after an earlier empty sweep or after Auth deletion. Both outboxes have no Auth foreign key. Ordinary upload reservation still refuses all accounts with deletion fences.

There are at most two heavy copies per account-cleanup request, no concurrent copy fan-out, a 64 MiB verification ceiling (above the current Project bucket's 10 MiB upload cap), and per-operation timeouts. Conflicting active deletions or copy failures remain retryable and retain the old bytes.

Repository tests exercise real `service_role` and `authenticated` permissions without granting `service_role` access to `auth.users`; private helper access, forged references, late copies, changed object versions, competing deletion fences, byte corruption, and exactly-once retained quota accounting are covered. Production Storage execution remains part of the deployment acceptance gate.

References: [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership), [JavaScript copy API](https://supabase.com/docs/reference/javascript/v1/storage-from-copy), [Auth user deletion](https://supabase.com/docs/guides/auth/managing-user-data).
