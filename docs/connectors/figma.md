# Figma file metadata connection

This KovaGPT integration uses Figma OAuth with per-user authorization, PKCE S256, encrypted refresh tokens and a read-only metadata endpoint. It does **not** provide a global search of Figma files, download full file contents, or modify designs.

## Production registration

- Register a public or private Figma OAuth app in the Figma developer portal.
- Request only `current_user:read` and `file_metadata:read` scopes.
- Set the callback URL to `https://kovagpt.com/api/integrations/oauth/callback/figma`.
- Store `FIGMA_OAUTH_CLIENT_ID` and `FIGMA_OAUTH_CLIENT_SECRET` as existing Azure Container App server secrets.
- Confirm the shared `CONNECTOR_TOKEN_ENCRYPTION_KEY` is configured.

A public app requires Figma review and approval before it can authorize general users. Never bypass OAuth consent or provider verification.

## Supported operation

The `figma_file_lookup` tool accepts an exact Figma file key or a `https://www.figma.com/design/<file-key>/...` or `/file/<file-key>/...` URL. The file key is validated, then Kova calls `GET https://api.figma.com/v1/files/:key/meta`.

Only the Figma file key, title, last-touched time and a Figma-domain link are returned. Kova does not return creator identities, thumbnails, hidden file details or full design contents.

## Acceptance

The connection remains `setup_required` until provider credentials are configured, a user completes OAuth, and an authorized file metadata lookup succeeds in production. Verify bad URL rejection, cross-user restrictions, token renewal, revoked permissions and disconnect.

References: [OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/), [file metadata endpoint](https://developers.figma.com/docs/rest-api/file-endpoints/), [permissions](https://developers.figma.com/docs/rest-api/scopes/).
