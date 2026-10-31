# Work app connections

The Connections page lists twelve work apps. Implemented operations are enabled only when the server configuration and the current user's provider consent are valid. Provider registration, credentials, owner consent and a successful real read must all be verified before describing a connection as live.

Google and GitHub use their dedicated connection flows. Microsoft covers Outlook, OneDrive, SharePoint and Teams. Notion, Linear, Slack and Salesforce use the shared OAuth account lifecycle. Credentials belong in the deployment's server secret manager.

| Provider   | Callback                                                         | Server credentials                                             | Implemented operation                                                                                |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Microsoft  | `https://kovagpt.com/api/integrations/oauth/callback/microsoft`  | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`   | Outlook message search, OneDrive file search, accessible SharePoint site search, joined Teams lookup |
| Notion     | `https://kovagpt.com/api/integrations/oauth/callback/notion`     | `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`         | Page title search over pages shared with the integration                                             |
| Linear     | `https://kovagpt.com/api/integrations/oauth/callback/linear`     | `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET`         | Issue title search with the `read` scope                                                             |
| Slack      | `https://kovagpt.com/api/integrations/oauth/callback/slack`      | `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`           | Message search with the user's `search:read` token                                                   |
| Salesforce | `https://kovagpt.com/api/integrations/oauth/callback/salesforce` | `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET` | Name search over an explicitly selected Account, Contact or Opportunity record type                  |

Provider settings can require administrator consent, workspace installation, public distribution approval, verification or account eligibility. Configuring an app for one workspace does not prove it can be installed by other workspaces.

## Salesforce registration and session renewal

Create an External Client App for a new Salesforce registration. Salesforce restricts creation of older Connected Apps beginning with Spring '26. Register the exact callback above and enable authorization-code OAuth with PKCE S256. The adapter uses production `login.salesforce.com` authorization. Sandbox-specific sign-in is not exposed.

Request `openid`, `api` and `refresh_token`. Salesforce's `api` scope permits API access according to the user's Salesforce role and can authorize writes at the provider. Kova implements only bounded GET queries here; it does not provide Salesforce write operations. Users should connect a Salesforce role with appropriate object and field permissions.

The OAuth callback verifies UserInfo before storing the credential. The access token, validated Salesforce query endpoint, organization and user identity are encrypted together. Requests reject arbitrary hosts, redirects, API paths and record types. Query text is escaped as a LIKE literal; object names, fields, order and a ten-record maximum are fixed on the server.

Salesforce session expiration is controlled by the organization. Kova does not invent an expiry when `expires_in` is absent. A rejected API read can claim a refresh once, verify the same organization and user again, persist the renewed encrypted credential, and retry that read once. Disconnect, reconnect, owner changes, workspace changes, configuration removal and Lockdown invalidate an in-flight operation. A failed or uncertain refresh requires reconnecting; it is not replayed.

Disconnection attempts Salesforce's token-revocation endpoint on the validated Salesforce origin. The UI distinguishes confirmed remote revocation from removal of Kova's local credential.

## Acceptance

For each enabled provider, verify owner consent and an actual authorized read through Kova, then exercise denied permissions, expiration and disconnect. A successful protocol test, a configured client ID or a healthy website alone is not provider acceptance.

Official Salesforce references:

- [External Client Apps and OAuth](https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html)
- [Authorization-code flow and PKCE](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5)
- [UserInfo endpoint](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_using_userinfo_endpoint.htm&type=5)
- [Refresh flow](https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-refresh-token-flow.html)
- [Token revocation](https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-revoking-tokens.html)
