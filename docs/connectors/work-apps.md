# Work app connections

Opening Connections attempts to renew up to three expiring grants already linked to the signed-in account. It uses the existing provider consent. If the provider rejects renewal, use that service’s reconnect action. A grant still needs the permissions required by the specific operation.

The Connections page exposes work apps when their server configuration is available. Implemented operations are enabled only when the server configuration and the current user's provider consent are valid. Provider registration, credentials, owner consent and a successful real read must all be verified before describing a connection as live.

Google and GitHub use their dedicated connection flows. Microsoft covers Outlook, OneDrive, SharePoint and Teams. Box, Canva, Figma, Calendly, BigQuery, HubSpot, Notion, Linear, Slack and Salesforce use the shared OAuth account lifecycle. Credentials belong in the deployment's server secret manager.

| Provider   | Callback                                                              | Server credentials                                             | Implemented operation                                                                                                                                           |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft  | `https://kovagpt.com/api/integrations/oauth/callback/microsoft`       | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`   | Outlook message search, OneDrive file search, basic calendar event search, accessible SharePoint site search, joined Teams lookup and Teams chat message search |
| Notion     | `https://kovagpt.com/api/integrations/oauth/callback/notion`          | `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`         | Title search and bounded Markdown reads for shared pages                                                                                                        |
| Linear     | `https://kovagpt.com/api/integrations/oauth/callback/linear`          | `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET`         | Issue title search with the `read` scope                                                                                                                        |
| Slack      | `https://kovagpt.com/api/integrations/oauth/callback/slack`           | `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`           | Message search with the user's `search:read` token                                                                                                              |
| Salesforce | `https://kovagpt.com/api/integrations/oauth/callback/salesforce`      | `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET` | Name search over an explicitly selected Account, Contact or Opportunity record type                                                                             |
| Box        | `https://kovagpt.com/api/integrations/oauth/callback/box`             | `BOX_OAUTH_CLIENT_ID`, `BOX_OAUTH_CLIENT_SECRET`               | File metadata search for files the authorized Box user can access                                                                                               |
| Canva      | `https://kovagpt.com/api/integrations/oauth/callback/canva`           | `CANVA_OAUTH_CLIENT_ID`, `CANVA_OAUTH_CLIENT_SECRET`           | Design metadata search                                                                                                                                          |
| Figma      | `https://kovagpt.com/api/integrations/oauth/callback/figma`           | `FIGMA_OAUTH_CLIENT_ID`, `FIGMA_OAUTH_CLIENT_SECRET`           | File metadata by design link or file key                                                                                                                        |
| Calendly   | `https://kovagpt.com/api/integrations/oauth/callback/calendly`        | `CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET`     | Upcoming active meeting names and times for the connected user                                                                                                  |
| BigQuery   | `https://kovagpt.com/api/integrations/oauth/callback/google-bigquery` | `BIGQUERY_OAUTH_CLIENT_ID`, `BIGQUERY_OAUTH_CLIENT_SECRET`     | Dataset names and locations in one authorized Google Cloud project                                                                                              |
| HubSpot    | `https://kovagpt.com/api/integrations/oauth/callback/hubspot`         | `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`       | Company name and domain search in one authorized HubSpot portal                                                                                                 |

Provider settings can require administrator consent, workspace installation, public distribution approval, verification or account eligibility. Configuring an app for one workspace does not prove it can be installed by other workspaces.

## Box, Teams, and Notion acceptance

- **Box** uses a Box OAuth 2.0 Platform App with `root_readonly`. Register its callback above and configure both server secrets. Search for a uniquely named fixture file, then verify token renewal and disconnect. Kova returns file metadata and links.
- **Microsoft Teams** uses a work or school account. Joined team lookup requests `Team.ReadBasic.All`. Choose **Chat messages** under **Teams access** to request delegated `Chat.Read`. Search for a test phrase in a conversation that account can access. Verify that the account cannot search messages after granting only joined-team access.
- **Notion** uses the pages shared during authorization and the integration's Read content capability. Search by title, then read the page ID returned by the search. For acceptance, verify that sharing a different set of pages changes what Kova can read. A bounded response can omit some content, and the request leaves transcript inclusion off.
- **Notion linked page** works with the deployment's existing credential vault and a workspace internal integration token. Enable only Read content in Notion and share the intended page with the integration. In Connections → Notion, enter the page ID and token. Kova verifies the page read, then encrypts the token together with the page ID. Select **Read linked page** to verify access again, or use the linked-page tool with the query `open`. Verify that the tool rejects a different page ID and that removing the integration from the page blocks the read. Disconnect deletes the stored credential from Kova. Revoke the integration token in Notion if it should stop working elsewhere.

[Box file search](https://developer.box.com/reference/get-search) · [Microsoft Teams message search](https://learn.microsoft.com/en-us/graph/search-concept-chat-messages) · [Notion page Markdown reads](https://developers.notion.com/reference/retrieve-page-markdown)

## Canva and Figma acceptance

Register the exact callbacks above in the providers' developer portals. Canva needs `design:meta:read`. Verify a unique design title and its view link from the account that authorized the app. Figma needs `current_user:read` and `file_metadata:read`. Verify metadata for a known design link, then verify denial for a file that account cannot access. A public Figma app requires provider review before general distribution.

[Canva design search](https://www.canva.dev/docs/apps/rest-apis/reference/designs/list-designs/) · [Figma OAuth setup](https://developers.figma.com/docs/rest-api/oauth-apps/)

## Calendly, BigQuery, and HubSpot acceptance

- **Calendly** requires `users:read` and `scheduled_events:read`. Authorize a test user with a known upcoming meeting and search by its title. Verify that meetings from a different user and canceled meetings are absent, then verify refresh and disconnect. Kova exposes meeting titles and times.
- **BigQuery** requires a separate Google Cloud OAuth project for this connector so disconnecting its grant is isolated from Gmail, Calendar, and Drive. Enable the BigQuery API in that project and register the callback. Authorize a test user with `bigquery.readonly` and dataset metadata access in a test project. Enter the exact project ID and verify that only permitted dataset metadata appears. Kova does not start jobs, list table rows, or execute SQL.
- **HubSpot** requires an OAuth app with `crm.objects.companies.read` and an eligible portal. In Connections, select Contacts and authorize the optional `crm.objects.contacts.read` scope to search first or last names. Verify that a company-only grant cannot run a contact search. Verify the portal shown after authorization using a distinct company name, then verify the grant against a second authorized portal. Kova disconnect destroys its stored credential. Remove the installation from HubSpot to revoke provider-side access.

[Calendly scopes](https://developer.calendly.com/docs/authentication/scopes) · [BigQuery datasets list](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/datasets/list) · [HubSpot CRM search](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm)

## Stripe acceptance

Create a public Stripe App with OAuth and `charge_read`. For optional draft invoice support, publish an app version with `invoice_write` and have users accept the updated installation. Set its callback to `https://kovagpt.com/api/integrations/oauth/callback/stripe`. Use the Stripe App Marketplace client ID and the matching developer API key in `STRIPE_APPS_OAUTH_CLIENT_ID` and `STRIPE_APPS_OAUTH_API_KEY`. Use a matched external-test client ID and test key in staging. The app must be accepted and published by Stripe for public installation.

Authorize a dedicated Stripe test account. In Kova, check `recent` and a known test charge ID. Confirm that a grant without charge access fails the connection and that a test credential cannot replace a live credential. Enable **Read and write** and review a test customer ID to create an empty draft invoice. Confirm it is unfinalized, has a zero amount due, excludes pending invoice items, and has automatic advance disabled. Disconnect removes the grant from Kova. Remove the app in Stripe to revoke the provider's access.

[Stripe Apps OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth) · [Stripe App permissions](https://docs.stripe.com/stripe-apps/reference/permissions)

## HyperFrames acceptance

Create a dedicated restricted HeyGen API key with `hyperframes:read` and enter it under **Connections → HyperFrames by HeyGen**. Kova tests the key against the render list before storing it encrypted. Search by title, list recent renders, or check an exact render ID. For optional rendering, grant `hyperframes:write` to the key, enable **Read and write**, and review a previously uploaded project ZIP asset ID. A render can use HeyGen credits. Reuse the same request UUID to retry the same submission without creating another render within HeyGen’s idempotency window.

Verify a known render appears with a read grant and that revoking the key in HeyGen blocks a subsequent read. Use Disconnect in Kova to remove the local key.

[HyperFrames render list](https://developers.heygen.com/reference/list-hyperframes-renders) · [HeyGen API key scopes](https://developers.heygen.com/docs/api-key-permissions)

## Gamma acceptance

Register one confidential Gamma OAuth client with `client_secret_post` and callback `https://kovagpt.com/api/integrations/oauth/callback/gamma`. Store the returned credentials under `GAMMA_OAUTH_CLIENT_ID` and `GAMMA_OAUTH_CLIENT_SECRET`. Kova requests `gamma:read` by default and verifies the authorized user and workspace. Choosing provider write authorization requests the separate `generate` scope. Token renewal preserves the existing scope, user, and workspace.

Search for a known document title or enter `recent`. Kova returns up to ten document titles, Gamma links and last-modified dates. To test the optional write, enable it in Kova and approve the brief for a private three-card presentation. Gamma can consume workspace credits. Use `generation:ID` to check the returned generation ID and open the completed Gamma. Verify that another workspace's documents are excluded and that a metadata-only account cannot start generation.

[Gamma OAuth](https://developers.gamma.app/get-started/authenticate-with-oauth) · [Gamma API index](https://developers.gamma.app/llms.txt)

## Granola acceptance

In the Granola desktop app, create a dedicated personal API key under **Settings → Connectors → API keys**. Grant only the notes access needed for your test. In KovaGPT, open **Connections → Granola** and enter that key. Kova verifies the key against Granola before storing it encrypted. One personal key can be linked per Kova account. Kova searches titles within the first page of 25 visible notes, returns up to ten titles and dates, and has no Granola write operation.

Verify that a known note appears and an excluded note does not. Revoke the key in Granola and verify the read fails. Disconnect in Kova to remove the stored key. Granola manages revocation in its own settings.

[Granola API access and revocation](https://docs.granola.ai/help-center/sharing/integrations/granola-api)

## Meltwater, Vercel, Mixpanel, and eToro acceptance

| Provider  | Credential and test                                                                                                                                                                | Kova read                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Meltwater | Create a dedicated token in Account → Meltwater API. Test with a known saved search.                                                                                               | Saved search names and last-updated dates.                          |
| Vercel    | Use a dedicated access token for a test team and enter its team ID. Search using a known project ID, then try a project from a different team.                                     | Up to ten deployment names, states and targets for the linked team. |
| Mixpanel  | Use a minimum-privilege service account and specify its project, data region, and workspace ID if the project uses Data Views. Verify a known cohort and deny a different project. | Up to ten saved cohort names and aggregate counts.                  |
| eToro     | Use public and user keys from a real account with the Read permission. Confirm the values in eToro and try a demo-only key to verify rejection.                                    | Provider-reported portfolio value, cash balance and unrealized P&L. |

These adapters verify their read against the provider before saving credentials. The optional Mixpanel write imports one event into the linked project and region, using an account with ingestion access. Verify the event timestamp, distinct ID and unique event ID in a test project. Kova removes the locally stored credential on disconnect. Revoke the dedicated key, token, or service account with its provider to invalidate it. Vercel and Mixpanel binding details are saved alongside the encrypted credential.

For optional eToro writes, use a user key with portfolio read and watchlist write access. Enable **Read and write** and review the name of a new static watchlist. Verify that the empty watchlist appears under the linked user's account. Test the same action with a read-only key and expect permission denial. [eToro create watchlist](https://api-portal.etoro.com/api-reference/watchlists/create-a-new-watchlist)

[Meltwater saved searches](https://developer.meltwater.com/docs/meltwater-api/listening/manage-searches/) · [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/list-deployments) · [Mixpanel cohorts API](https://docs.mixpanel.com/reference/cohorts-list) · [eToro API](https://builders.etoro.com/reference)

## IBKR, S&P Global, Webull and Wix acceptance

| Provider            | Setup                                                                                                                                                                                                                                     | Read to verify                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interactive Brokers | Enable Flex Web Service in Client Portal. Use an XML Activity Flex query limited to the intended accounts and the Open Positions section. Include Symbol, Currency and Quantity. Enter the query ID and Flex token in Connections.        | Compare symbol, currency and quantity against the selected statement. Confirm revoked or expired tokens fail. IBKR generates the report asynchronously and throttles requests. |
| S&P Global          | Confirm that the account's Capital IQ contract permits Kova's use of the Kensho company match API. Set `KOVA_SP_GLOBAL_ENABLED=true` after license review. Use a dedicated Capital IQ API username and password.                          | Find a known company and verify its identifier, industry and country. Confirm an account without company-match access fails setup.                                             |
| Webull              | Use credentials issued to an eligible OpenAPI app. Choose Sandbox or Production explicitly. For accounts that require a verified access token, obtain it through Webull's own verification flow and enter it with the app key and secret. | Compare authorized account types. Test expired access and a credential for the other environment.                                                                              |
| Wix                 | Generate a client secret for an eligible self-managed Wix Headless project. Enter its client ID and secret.                                                                                                                               | Compare the authorized site's business name and locale. Try a revoked secret and confirm that switching the project requires a new credential.                                 |

Connect performs a provider read before saving the credential. Chat and Connections use the saved account binding. For the optional Wix write, use an app with Manage Business Profile permission, enable writing in Kova and review the new business name on a test site. Verify that locale and the other profile fields are unchanged. Revoke a provider credential in its issuing portal if it should stop working outside Kova.

For optional Webull writes, link an authorized access token with watchlist access in the intended environment. Use **Read and write** to review the name and create an empty watchlist. Start in Webull Sandbox and verify the returned list ID there. [Webull create watchlist](https://developer.webull.com/apis/docs/reference/create-watchlist/)

[IBKR Flex Web Service](https://www.interactivebrokers.com/docs/web-api/flex-web-service/) · [S&P Capital IQ developer guide](https://www.support.marketplace.spglobal.com/content/dam/spglobal/mi/en/documents/marketplace/api/guides/spglobalapidevelopersguide.pdf) · [Webull signed requests](https://developer.webull.com/apis/docs/authentication/signature/) · [Wix Headless client credentials](https://dev.wix.com/docs/go-headless/authentication/admin/make-admin-api-calls-with-client-credentials)

## Tana acceptance

Tana supports OAuth Client ID Metadata Documents. On `https://kovagpt.com`, Kova uses `https://kovagpt.com/.well-known/tana-mcp-client.json` as its public client ID. Check that the OAuth server can retrieve that JSON and that it lists the exact callback `https://kovagpt.com/api/integrations/oauth/callback/tana`. A separate test deployment can use a registered Tana client with its own exact callback. Configure that client with `TANA_MCP_CLIENT_ID` and `TANA_MCP_TOKEN_AUTH_METHOD`, plus `TANA_MCP_CLIENT_SECRET` for a confidential client.

Kova uses PKCE S256, binds the OAuth exchange to `https://home.tana.inc/mcp` and checks the `searchItems` tool before saving the user's grant. Only the most recently authorized Tana account is linked per Kova user. Test two Kova accounts against different Tana workspaces, a known private note, token renewal when the provider returns a refresh token, and revocation in Tana. For optional document creation, enable **Read and write**, load the live request fields, and review a JSON request matching the provider’s `createItems` schema. Verify that Tana returns a pending proposal session and requires its own approval before applying it.

[Tana hosted MCP](https://tana.inc/learn/features/mcp) · [MCP resource metadata](https://home.tana.inc/.well-known/oauth-protected-resource/mcp) · [Tana OAuth server metadata](https://login.tana.inc/.well-known/oauth-authorization-server)

## Custom MCP acceptance

Review the server's ownership, its return data, and a read-only tool that accepts a single string query with no additional required arguments. Configure the approved endpoint and exact tool name in the server environment using this JSON format.

```json
[
  {
    "id": "docs",
    "url": "https://docs.example.com/mcp",
    "tool": "search_docs",
    "queryField": "query"
  }
]
```

Set that JSON as `KOVA_MCP_READ_SERVERS`. The server must support Streamable HTTP with an MCP handshake version from 2025, an HTTPS endpoint with a public IPv4 DNS record, a per-user bearer token, and the MCP `readOnlyHint` annotation on the reviewed tool. Verify that the approved tool accepts the probe query `recent` before adding the server. In Connections enter the approved server ID and a restricted bearer token issued by that server. Kova verifies the listed schema and calls only the configured tool. Returned tool text is treated as source data.

Verify connection and successful reads with the intended role, missing permission and revocation, reconnect after an endpoint or tool change, and isolation between two Kova accounts. Confirm that an unapproved ID and tools that no longer declare read access fail before invocation.

For an optional write, add `writeTool` and `writeField` to the registration. Review a non-destructive tool that accepts one required string argument, declares `readOnlyHint: false` and `destructiveHint: false`, and returns `structuredContent.ok: true` on success. Link a bearer token with permission for that exact tool. Enable **Read and write** after linking and review each proposed call. Changing the approved write tool or field requires linking again before that new action can run.

[MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [MCP tool definitions](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## Excalidraw acceptance

Select a version 2 `.excalidraw` file in the chat attachment picker. The attachment contains a summary of up to 100 visible diagram elements and their text and positions. Embedded images, links and application state stay outside the summary. In Kova’s Drawing dialog, draw a sketch and choose **Download Excalidraw file**. Open the downloaded file in Excalidraw and verify that the strokes are editable.

The user chooses files and initiates each download. This adapter exchanges files locally and has no Excalidraw cloud account binding.

[Excalidraw scene file format](https://docs.excalidraw.com/docs/codebase/json-schema)

## Salesforce registration and session renewal

Create an External Client App for a new Salesforce registration. Salesforce restricts creation of older Connected Apps beginning with Spring '26. Register the exact callback above and enable authorization-code OAuth with PKCE S256. The adapter uses production `login.salesforce.com` authorization. Sandbox-specific sign-in is not exposed.

Request `openid`, `api` and `refresh_token`. Salesforce uses the same `api` scope for reads and writes and enforces the user's object and field permissions. KovaGPT starts with search access and requires explicit opt-in and review before creating an account record.

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

## Directory submissions and write access

Apply the connector controls and submissions migration before deploying the directory. Use the existing administrator allowlist to review submissions. Authors can save drafts and resubmit when a reviewer requests changes. A public repository must have a readable `kova-plugin.json` at its root. The directory verifies its name and description and publishes a link after approval. A remote MCP submission requires a configured, reviewed read tool before publication. Submission validation never sends a request to an unapproved MCP URL or executes bundle code.

The account or repository Permissions panel starts at Read only. Write access needs both the provider grant and the KovaGPT setting. Gmail draft and send actions and Google Calendar event creation retain their chat approval. GitHub and Linear issues, new Google Drive and OneDrive folders, Outlook drafts, and personal Outlook Calendar events have a review step in the directory. Linear uses the optional `issues:create` scope and requires the selected team UUID. Google folder creation uses the per-file Drive scope. Outlook Calendar uses explicit UTC times without attendees. Outlook drafts stay in Drafts. Switching back to Read only blocks subsequent KovaGPT writes. Review the provider's account settings to remove its underlying grant.

The directory also supports these reviewed actions when the connected account has the required provider permission.

| Connector             | Action                                                                               | Provider permission                                                    |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Box                   | Create a root folder                                                                 | `root_readwrite`                                                       |
| Calendly              | Create a single-use link for an existing event type                                  | `scheduling_links:write`                                               |
| Canva                 | Create a blank square design                                                         | `design:content:write`                                                 |
| Figma                 | Post a comment to the selected file                                                  | `file_comments:write`                                                  |
| Google Cloud BigQuery | Create an empty dataset in the selected project and location                         | `bigquery` scope and `bigquery.datasets.create` IAM permission         |
| HubSpot               | Create a company record                                                              | `crm.objects.companies.write`                                          |
| Microsoft Teams       | Send a plain-text message in an existing chat                                        | `ChatMessage.Send` with chat read access on a work or school account   |
| Meltwater             | Create a saved search from a reviewed Boolean query                                  | API key with saved-search write access                                 |
| Notion                | Append a paragraph to a shared page or the one page bound to an internal integration | Insert content and access to the page                                  |
| Salesforce            | Create an Account record                                                             | `api` and permission to create the Account object                      |
| SharePoint            | Create a list item with a title                                                      | `Sites.ReadWrite.All` and permission to add items to the selected list |
| Slack                 | Send a message to an existing conversation                                           | `chat:write` for the connected user and access to the conversation     |
| Vercel                | Create an empty project in the linked team                                           | Team-scoped token with Create Project permission                       |
