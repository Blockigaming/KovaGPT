# Google account lifecycle

This package implements repository source and isolated regressions. It does not enable OAuth, apply a production migration, or establish live provider availability.

## Account and credential boundaries

Google connections use an immutable connection UUID and a unique `(user_id, google_sub)` identity. The credential vault, preferences, consent attempts, and vault RPC are service-role-only. Account-action browser helpers require a captured Kova user ID, and Summary status verifies the captured user against its authenticated server context. Browser status exposes connection IDs, verified email, scopes, health, selected ID, connection revision, and selection revision. It never exposes tokens, grant generations, or refresh state.

Existing single-account rows keep their selected connection. A legacy token must be verified using Google's authenticated UserInfo endpoint before use; successful legacy verification also reseals plaintext credentials. Missing identities require targeted reauthorization. Refresh tokens cannot move between Google identities. Disconnect purges local credentials first, rotates the grant, closes pending consent, and then attempts bounded provider revocation. Account deletion invokes `disconnectAllGoogle` and requires successful local purge before Auth deletion.

Every vault operation shares the account-deletion advisory lock. Fenced or soft-deleted accounts cannot read, connect, select, refresh, or complete consent. Only disconnect remains usable while deletion is fenced. Refresh uses a 45-second database lease and credential revision checks. A delayed refresh or OAuth callback cannot resurrect revoked credentials. Completing consent closes parallel old consent windows; open a new consent window if another connection was completed first.

## Browser and Tasks contract

- `GET /api/google/status`: selected health plus `accounts`, `selectedConnectionId`, and `selectionRevision`.
- `POST /api/google/select`: `{ connectionId, expectedRevision }`; stale selection returns 409.
- `POST /api/google/disconnect`: `{ connectionId, expectedRevision: connectionRevision }`; stale credential generations return 409 and no implicit all-account operation exists.
- `/api/google/auth?connectionId=UUID`: targeted reauthorization. Without an ID it adds a connection. Adding another account preserves the current selection.
- Read endpoints may receive `connectionId`. Explicit IDs never fall back to another account.
- Server integrations call `getValidGoogleAccessToken(userId, { connectionId, grantId, expectedGoogleSub, capability })`. Durable Tasks grants must store the exact connection ID, grant UUID, and Google subject and request current capabilities. User ID alone is insufficient for a durable grant.
- Chat captures its selected binding once outside model arguments. Pending writes retain the exact connection, grant, and subject. Previews identify the Google email; confirmation fails if identity or permission generation changed. `gmail.compose` permits draft and send; `gmail.send` alone does not permit draft creation.
- Summary reads pin the selected connection and hide previous selection content while status refreshes.

Account selection is a default for new operations; an already approved write remains bound to the account shown in its preview. Reauthorization, revocation, or reduced scopes invalidates that approval.

## Export and validation

The owner export registry includes `google_connection_export_rows` (`user_id`, `id`, `google_sub`, `email`, `scopes`, `created_at`, `updated_at`, `expires_at`, `revoked_at`) and `google_connection_preferences` (`user_id`, `selected_connection_id`, `revision`). Credentials, lease state, OAuth attempt IDs, and internal grant generations are excluded.

Isolated tests execute the actual SQL migration and runtime to cover ownership, selection CAS, service-only privileges, legacy verification/resealing, refresh serialization and identity mismatch, permission reduction, stale consent, deletion fences, purge ordering, and exact binding validation. Hosted upgrade rehearsal remains the authority for the complete existing schema. Production consent configuration, credentials, migration execution, enablement, and deployment remain owner actions.

Provider contracts: [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference), [Google web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

Browser regression coverage exercises account selection and refresh while old selection stays visible with controls disabled, exact revision-bound disconnect, targeted reauthorization with the CSRF cookie, and a delayed response after sign-out. These tests mock provider/backend traffic and do not establish live OAuth availability.

## Rejected callback settlement

The callback claims the exact still-open consent attempt before sending its authorization code to Google. Replayed, closed, disconnected, fenced and stale targeted attempts fail before token exchange. The encrypted provider response is staged immediately after exchange, before UserInfo. Identity lookup failures retain that response for a leased recovery worker; expired access can use its staged refresh token solely to establish identity and complete or compensate the original consent. Unknown-subject credentials are never blindly revoked. Completion and its accepted/rejected receipt are committed in one transaction. A lost database response is reconciled from that immutable receipt; an uncertain response never authorizes revocation of a possibly accepted connection.

Definitively rejected credentials are encrypted in a service-only compensation receipt, then sent to Google's revocation endpoint with a bounded POST body. They are removed after confirmed revocation or an invalid-token response. Provider failure preserves the encrypted retry and a subject fence, so a concurrent callback cannot install credentials that an outstanding revocation could later invalidate. A new consent attempt after cleanup can connect normally. Google revocation can affect every token for the same app and Google subject; therefore an already accepted connection for that subject, including one owned by another Kova account, is protected and the rejected duplicate credentials are discarded without revoking that accepted grant.

Cleanup runs after a rejected callback and opportunistically before new consent. A dedicated `POST /api/internal/google-oauth-cleanup` processes one retry for an authorized scheduler. It is disabled until the owner configures `GOOGLE_OAUTH_CLEANUP_SECRET`; it accepts no receipt ID, user ID, payload or query arguments. Provider registration, secret entry, migration and worker scheduling are still owner activation actions; no live callback or revocation was performed during repository implementation.

Receipts expose no browser access and are omitted from account exports. Accepted/protected/revoked receipts and abandoned empty claims are pruned after one day in bounded batches. Only still-pending encrypted recovery or compensation survives account deletion, with its Auth owner reference cleared, until provider cleanup can complete. The owner hash and Google subject are operational correlation data; they are never returned by the cleanup endpoint. This narrow retention enables deletion-time compensation without preserving usable application credentials.
