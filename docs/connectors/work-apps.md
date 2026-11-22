# Work app connections

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

Create a public Stripe App with OAuth and only the `charge_read` permission. Set its callback to `https://kovagpt.com/api/integrations/oauth/callback/stripe`. Use the Stripe App Marketplace client ID and the matching developer API key in `STRIPE_APPS_OAUTH_CLIENT_ID` and `STRIPE_APPS_OAUTH_API_KEY`. Use a matched external-test client ID and test key in staging. The app must be accepted and published by Stripe for public installation.

Authorize a dedicated Stripe test account. In Kova, check `recent` and a known test charge ID. Confirm that a grant without charge access fails the connection and that a test credential cannot replace a live credential. Disconnect removes the grant from Kova. Remove the app in Stripe to revoke the provider's access. Kova returns payment amounts in Stripe minor units and status. This integration has no payment or refund write operation.

[Stripe Apps OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth) · [Stripe App permissions](https://docs.stripe.com/stripe-apps/reference/permissions)

## HyperFrames acceptance

Create a dedicated restricted HeyGen API key with `hyperframes:read` and enter it under **Connections → HyperFrames by HeyGen**. Kova tests the key against the render list before storing it encrypted. The Connections and chat read returns up to ten recent render names and statuses. Creation, deletion and signed media download links are outside this adapter.

Verify a known render appears with a read grant and that revoking the key in HeyGen blocks a subsequent read. Use Disconnect in Kova to remove the local key.

[HyperFrames render list](https://developers.heygen.com/reference/list-hyperframes-renders) · [HeyGen API key scopes](https://developers.heygen.com/docs/api-key-permissions)

## Gamma acceptance

Register one confidential Gamma OAuth client with `client_secret_post` and callback `https://kovagpt.com/api/integrations/oauth/callback/gamma`. Store the returned credentials under `GAMMA_OAUTH_CLIENT_ID` and `GAMMA_OAUTH_CLIENT_SECRET`. Kova requests `gamma:read` for the public API and verifies the selected user and workspace with Gamma before storing the grant. Authorization and refresh never request the `generate` scope.

Search for a known document title or enter `recent`. Kova returns up to ten document titles, Gamma links and last-modified dates. Verify that documents from a workspace you did not authorize are excluded. Verify token renewal keeps the same workspace and that Kova disconnect removes the local grant. Gamma document creation and edits are still pending.

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

These adapters verify their read against the provider before saving credentials and never send provider writes. Kova removes the locally stored credential on disconnect. Revoke the dedicated key, token, or service account with its provider to invalidate it. Vercel and Mixpanel binding details are saved alongside the encrypted credential.

[Meltwater saved searches](https://developer.meltwater.com/docs/meltwater-api/listening/manage-searches/) · [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/list-deployments) · [Mixpanel cohorts API](https://docs.mixpanel.com/reference/cohorts-list) · [eToro API](https://builders.etoro.com/reference)

## Excalidraw acceptance

Select a version 2 `.excalidraw` file in the chat attachment picker. The attachment contains a summary of up to 100 visible diagram elements and their text and positions. Embedded images, links and application state stay outside the summary. In Kova’s Drawing dialog, draw a sketch and choose **Download Excalidraw file**. Open the downloaded file in Excalidraw and verify that the strokes are editable.

The user chooses files and initiates each download. This adapter exchanges files locally and has no Excalidraw cloud account binding.

[Excalidraw scene file format](https://docs.excalidraw.com/docs/codebase/json-schema)

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
