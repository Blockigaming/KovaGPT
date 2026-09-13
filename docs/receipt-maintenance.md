# Work and template receipt maintenance

`POST /api/internal/receipt-maintenance` is a bounded internal maintenance entry point for the existing Work and Project-template replay receipts. It never deletes saved Work, Recent-item tombstones, template versions, grants or audit events.

The endpoint remains unavailable until the server has a dedicated `RECEIPT_MAINTENANCE_SECRET`. A caller must provide that value as a Bearer token. It accepts no body or query parameters, always returns `Cache-Control: no-store`, and returns generic errors without identifiers, SQL or secrets.

Each invocation sequentially removes at most 500 Work receipts and 500 Project-template receipts older than eight days. Both existing database functions enforce a minimum seven-day retention period and service-role-only execution. Each RPC has a ten-second deadline and cancellation signal. Retries after a partial failure safely continue from the next remaining batch; counts describe only a fully successful invocation.

Deployment and scheduler activation are separate owner-approved steps. After the exact migrations and candidate pass staging, provision the secret through the existing secret store, schedule the endpoint using existing approved capacity, and verify unauthorized/configuration failures, successful counts, timeouts, and retry behavior. Alert on repeated 503 responses or sustained full batches. Never place the secret in logs, URLs, repository files or shared reports.

Receipt retention is not a user-content retention policy. Retained records and deletion tombstones follow their own lifecycle. Account-export artifact obligations are managed by the account-export worker and are intentionally excluded from this purge.
