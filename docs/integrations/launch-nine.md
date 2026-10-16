# Nine required launch connectors: source implementation

This continues PR #445 from `33401a35d85edc34b1980b7f8a78317ec2b5b027`.
It implements real read-only OAuth/provider adapters for the nine remaining
required plugins. It does **not** certify a provider or complete launch acceptance.
The scope is still exactly Gmail, Google Calendar, Google Drive, Outlook,
OneDrive, SharePoint, Microsoft Teams, Notion, GitHub, Linear, Slack, Salesforce,
and HubSpot. The existing Google and GitHub implementations remain in place.

## Operations and permission contracts

| Plugin          | Implemented operations                                                           | Requested data permissions                                                      |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Outlook         | List mailbox messages; read a message body                                       | Delegated `Mail.Read`                                                           |
| OneDrive        | List root/folder files; retrieve metadata; read bounded UTF-8 text               | Delegated `Files.Read`                                                          |
| SharePoint      | Search sites; list default-drive files; retrieve metadata and bounded UTF-8 text | Delegated `Sites.Read.All`                                                      |
| Microsoft Teams | List chats/messages; scope-checked teams, channels, messages and replies         | Delegated `Chat.Read`; work/school accounts                                     |
| Notion          | Search page/data-source titles; retrieve page metadata; read child blocks        | Public integration with **Read content** capability and explicitly shared pages |
| Linear          | List issues; retrieve an issue including description and state                   | OAuth `read`                                                                    |
| Slack           | Search messages accessible to the authorizing user                               | OAuth **user** `search:read`; no bot-token substitution                         |
| Salesforce      | List Accounts; retrieve Account name/industry                                    | OAuth `api`, plus `openid` and `refresh_token`                                  |
| HubSpot         | Search contacts; retrieve contact name/email                                     | OAuth `crm.objects.contacts.read`, plus `oauth`                                 |

Microsoft also requests `User.Read`, `openid`, `profile`, and `offline_access`.
Each Microsoft plugin uses a separate credential record and consent request;
Outlook does not request Teams or file permissions. Salesforce's `api` scope is
broader than the two reads; the adapter never accepts arbitrary SOQL or REST paths.
Notion capability and page sharing are provider requirements, backed by a real
read probe before connection settlement.

These are **25 read operations**, not full provider feature parity. There are no
new sends, CRM writes, uploads, or destructive operations. OneDrive and SharePoint additionally read supported UTF-8 text files up to 64 KiB,
checking eTag before returning content. Office/PDF extraction is not implemented
in these adapters. Notion nested blocks require another explicit read. Teams channel
handlers require separate existing read scopes and are not enabled by Chat.Read. Future writes require
separate scoped consent and exact-action approval.

## Architecture and safeguards

- Reuses `integration_oauth_states`, `integration_linked_accounts`, consent,
  deletion, audit, and sync tables, with the existing AES-GCM credential vault.
- Requires Kova-owned cookie sessions. Callbacks revalidate the initiating owner
  **and session ID**, a separate per-plugin HttpOnly nonce, single-use SQL state,
  and the configured HTTPS callback origin. Hosted bearer-only sessions cannot
  start these flows.
- Uses PKCE S256 for Microsoft, Linear, Slack and Salesforce. Slack requires its
  app's PKCE setting and omits the client secret as documented. Notion uses JSON
  and HTTP Basic client authentication.
- Initial scopes come from provider responses/introspection, never the requested
  scope list. Only omitted scopes on refresh inherit the previous grant;
  explicitly reduced scopes fail. A profile and real read must succeed before
  settlement. Refresh verifies unchanged provider identity.
- Provider requests have a 15-second deadline, 1 MiB response ceiling, disabled
  redirects and fixed paths. Fixed error codes never expose upstream bodies or
  tokens. Salesforce instance origins must be HTTPS Salesforce domains.
- Every read checks owner, provider, status, scope and credential envelope.
  Session, lockdown and credential revision are rechecked before exposing results.
  Provider content is untrusted data, never model instructions.
- Settlement and disconnect share a SQL advisory lock. Disconnect expires pending
  and in-flight consent, destroys local credentials, and cancels sync/approvals
  transactionally **before** remote cleanup.
- Refresh uses a database compare-and-swap across server instances. A late refresh
  cannot resurrect a disconnected account. Uncertain/crashed refreshes require
  reconnect instead of blind token replay. Only an idempotent read can retry once.
- Encrypted cursors bind owner, account, plugin, operation, arguments and credential
  revision, and expire after ten minutes. Microsoft pagination additionally
  requires the same origin and resource path.
- The migration removes browser SELECT access to credential ciphertext. New SQL
  functions are `SECURITY INVOKER`, with EXECUTE limited to `service_role`.
  Existing owner RLS governs redacted metadata.

## Entry points and inactive gate

`/api/integrations/launch/$connector` accepts authenticated POST actions `connect`,
`read`, and `disconnect`. Reads include `accountId`, an allowlisted `operation`,
structured `args`, and optional opaque `cursor`. Server authority determines the
owner/session. Connect/read requests have a per-owner/per-plugin rate limit.
GET handles the registered OAuth callback.

`getLaunchToolContext` supplies the main assistant only certified, owned,
connected, adequately scoped accounts. The chat loop dispatches these reads
through the same runtime. Custom Kovas now filter exact tool names using the selected immutable configuration,
intersected with the chatting user’s certified, owned, adequately scoped accounts.
Configuration selection creates no grant. Current-context checks still run before
each dispatch. GitHub is outside this launch mapping; its existing separate
repository grants and approval paths are unchanged. Existing Google dispatch and GitHub approval paths
remain in place.

`CERTIFIED_LAUNCH_CONNECTORS` is deliberately empty. Credentials, environment
variables, catalog labels and request flags cannot enable a connector. Legacy
Microsoft/Slack/Notion/Linear generic OAuth cannot bypass this gate. The nine
catalog entries remain inactive, with an explanation distinguishing source
implementation from live verification. Apps detail panels now load bounded, owner/provider-scoped account metadata, display
identity and granted scopes, require unchecked consent, and confirm the exact account
for disconnect. Callback parameters only trigger a fresh saved-status read. Panels are
keyed by account/provider and abort/ignore late requests on close or account change.
Connect/read remain blocked by server certification; UI source is not live acceptance. Test dependency injection is not a deployment
activation mechanism.

Server configuration uses `KOVA_CONNECTOR_PUBLIC_ORIGIN` (an exact HTTPS origin),
the existing `CONNECTOR_TOKEN_ENCRYPTION_KEY`, and `<FAMILY>_OAUTH_CLIENT_ID` /
`<FAMILY>_OAUTH_CLIENT_SECRET` for `MICROSOFT`, `NOTION`, `LINEAR`, `SALESFORCE`,
and `HUBSPOT`. Slack PKCE uses `SLACK_OAUTH_CLIENT_ID`; its secret is not sent.
No SDK dependency or paid service was added. The migration is source only and has
not been applied to a live database.

## Disconnect and live requirements

Local revocation is implemented for all nine. Notion, Linear, Slack and Salesforce
have provider-specific remote revocation requests. Success requires a successful
provider response, including Slack's JSON `revoked` field. None is live-certified.

Microsoft has no implemented narrow per-grant revocation here; broad account
sign-out/admin permissions are not requested. HubSpot's documented uninstall
removes the **whole portal installation**, including other features/webhooks and
admin notifications. A per-account disconnect does not authorize that operation.
Microsoft reports `localDisconnected: true`, `providerRevoked: false`,
`remoteStatus: manual_revocation_required`. HubSpot now attempts the documented
`POST /oauth/2026-03/token/revoke` with client credentials and the refresh token
in the form body. A successful response reports `refreshTokenRevoked: true` and
`refresh_token_revoked_access_expiry_pending`, while `providerRevoked` remains false:
existing access tokens may survive until expiry and the portal app is not uninstalled.
Absent refresh tokens or failed cleanup require manual revocation. The SQL local
credential deletion remains first; no provider request is made by local tests.
See the [versioned refresh-token revocation contract](https://developers.hubspot.com/docs/api-reference/2026-03/authentication/oauth-tokens/revoke-token)
and [migration guide](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide), checked October 12, 2026.

Each provider still needs app/callback registration, secure credentials and key,
consent/admin approval where required, real connect and denied-consent checks,
representative reads, pagination/rate-limit checks, refresh/reconnect, two-user
isolation, and disconnect/provider-revocation verification. All those **live**
checks are **NOT RUN**. The four existing launch integrations still require their
own live certification; this source work does not upgrade their readiness.

## Official references checked October 8, 2026

- Microsoft: [OAuth code flow](https://learn.microsoft.com/en-us/graph/auth-v2-user),
  [messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0),
  [drive children](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0),
  [site search](https://learn.microsoft.com/en-us/graph/api/site-search?view=graph-rest-1.0),
  [chat messages](https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0).
- Notion: [token exchange](https://developers.notion.com/reference/create-a-token),
  [revocation](https://developers.notion.com/reference/revoke-token),
  [search](https://developers.notion.com/reference/post-search).
- Linear: [OAuth/PKCE/refresh/revocation](https://linear.app/developers/oauth-2-0-authentication),
  [GraphQL](https://linear.app/developers/graphql).
- Slack: [OAuth user tokens](https://docs.slack.dev/authentication/installing-with-oauth/),
  [PKCE](https://docs.slack.dev/authentication/using-pkce/),
  [rotation](https://docs.slack.dev/authentication/using-token-rotation/),
  [search](https://docs.slack.dev/reference/methods/search.messages/),
  [revocation](https://docs.slack.dev/reference/methods/auth.revoke/).
- Salesforce: [OAuth](https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html),
  [revocation](https://developer.salesforce.com/blogs/2011/11/revoking-oauth-2-0-access-tokens-and-refresh-tokens),
  [query resource](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query.html),
  [SOQL](https://developer.salesforce.com/docs/platform/salesforce-soql-sosl/guide/sforce-api-calls-soql-select-examples.html).
- HubSpot: [OAuth v3/introspection](https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens),
  [contact search](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/search/search-contacts),
  [portal uninstall semantics](https://developers.hubspot.com/changelog/public-beta-new-api-for-uninstalling-a-public-app-from-a-hubspot-account),
  [2026 certification requirements](https://developers.hubspot.com/changelog/app-listing-and-app-certification-requirement-updates-for-may-2026).

Regression tests exercise synthetic provider HTTP responses and normalized
results. Runtime tests use the actual SQL migration in PGlite with two owners and
the real credential vault. They cover callback replay, scope reduction, isolation,
disconnect/refresh races, role grants, cursors, and inactive HTTP/tool boundaries.
They establish source behavior, not real provider operational evidence.

## October 12 read extensions (local contracts only)

`read_file_text` supports plain text, CSV, Markdown, TSV and JSON up to 65,536 bytes.
A fresh Graph metadata read provides the download URL and eTag. Only HTTPS
Microsoft SharePoint and files.1drv.com subdomains are accepted. The download has
no OAuth Authorization header, no redirects, no partial response acceptance, a
15-second deadline and a streaming byte ceiling. A second metadata read must
confirm the same eTag. URLs/tokens are never returned as tool content. Other
formats, clouds or CDN domains fail closed; this is not general file extraction.

Teams `list_teams`, `list_channels`, `list_channel_messages` and
`list_channel_replies` require respectively `Team.ReadBasic.All`,
`Channel.ReadBasic.All`, and `ChannelMessage.Read.All` for the two message reads,
in addition to the current base Chat.Read connection. Existing consent remains
unchanged. Account-specific tool exposure and execution both enforce these scopes.
No write operation was added.

Official contracts checked October 12:
[drive content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0),
[joined teams](https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams?view=graph-rest-1.0),
[channels](https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0),
[channel messages](https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0),
[replies](https://learn.microsoft.com/en-us/graph/api/chatmessage-list-replies?view=graph-rest-1.0).
