# Auth migration go-live checklist

Application revision deployment and auth-data migration are separate change domains. An application rollback **does not** undo migrated users.

## Rehearsal

- Use only an explicitly allowlisted disposable destination and synthetic source. Historical `ca-kovagpt-auth-rehearsal` / project `oztdrjtdglkizlewnulh` are evidence, not current authorization.
- Run `auth-migration-rehearsal.mjs` against immediate sanitized preflight metadata. Require migration enabled, both generation kill switches, a DB secret reference, proven TLS connectivity, synthetic source, zero destination users/identities, and controlled ingress.
- A historical request returned HTTP 503 `database_connect_failed` with zero users/identities. **STOP: another request is not safe yet**. First prove current DB connectivity and repeat the zero-row check immediately before separate authorization.
- Permit exactly one synthetic request, record attempt ID/status, verify expected user/identity counts and replay idempotency, redact logs, then disable and re-check ingress.

## Preproduction

Use a separate nonproduction project, verified backup/restore path, representative synthetic volume, reconciliation report, retry/idempotency test, bridge-secret rotation, TLS validation, and rollback/forward-fix rehearsal. Do not point rehearsal commands at preproduction implicitly.

## Production

Requires explicit data-owner/security/change authorization, exact source/destination project guards, signed row-count/reconciliation plan, backup/restore decision, maintenance/cutover plan, and a production-specific invocation. No command in this repository authorizes this stage. Never use a default project ID or fallback principal.
