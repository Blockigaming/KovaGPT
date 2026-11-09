# Canva read-only connection

KovaGPT's Canva integration uses the public/private app OAuth authorization-code flow with PKCE S256. Only the current user's design metadata is searched; KovaGPT does not fetch design contents, export designs or create designs.

## Production registration

- Create a public or private Canva app in the Canva Developer Portal.
- Enable the `design:meta:read` permission. `profile:read` is optional.
- Register the exact callback: `https://kovagpt.com/api/integrations/oauth/callback/canva`.
- Store `CANVA_OAUTH_CLIENT_ID` and `CANVA_OAUTH_CLIENT_SECRET` in the existing Azure application's secret configuration. Never expose these credentials to the client.
- The existing `CONNECTOR_TOKEN_ENCRYPTION_KEY` must be set correctly. OAuth state, PKCE verification, account ownership, token encryption, token rotation and revocation of local credentials use the shared KovaGPT connector infrastructure.

## Supported operation

`canva_search` performs a read-only search on `GET https://api.canva.com/rest/v1/designs`, with an encoded query of at most 255 characters and a 10-item limit. It returns each design's ID, title, and up to three design-type labels. It deliberately omits thumbnails, owner identities, pagination cursors and short-lived signed design URLs.

A successful OAuth identity exchange means the account is linked, **not** that design search is operationally verified. The account owner must run **Verify read access**, and the service-specific audit must record an authorized Canva search on the current grant before claiming successful read access.

## Acceptance tests

Verify the OAuth redirect, denied consent, actual design metadata search, absent `design:meta:read` consent, rotating refresh tokens, changed or revoked account, and disconnect. Do not mark Canva Live until an authorized, signed-in production read has passed.

References: [OAuth authentication](https://www.canva.dev/docs/apps/rest-apis/authentication/), [token exchange](https://www.canva.dev/docs/apps/rest-apis/reference/authentication/generate-access-token/), and [list designs](https://www.canva.dev/docs/apps/rest-apis/reference/designs/list-designs/).
