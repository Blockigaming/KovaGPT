# KovaGPT connector master list

The Connections directory includes the 30 requested services and seven retained services. Health includes Oura, Apple Health, and Android Health Connect. Outlook Mail uses `outlook`.

Canonical metadata: `src/lib/connector-master-list.mjs`. The legacy service directory remains available for compatibility, but does not expand the approved master scope.

| Connector                                     | ID                       | Delivery                                        |
| --------------------------------------------- | ------------------------ | ----------------------------------------------- |
| Box                                           | `box`                    | Apps                                            |
| Calendly                                      | `calendly`               | Apps                                            |
| Canva                                         | `canva`                  | Apps                                            |
| eToro                                         | `etoro`                  | Apps                                            |
| Excalidraw                                    | `excalidraw`             | Apps                                            |
| Figma                                         | `figma`                  | Apps                                            |
| Gamma                                         | `gamma`                  | Apps                                            |
| GitHub                                        | `github`                 | Apps                                            |
| Gmail                                         | `gmail`                  | Apps                                            |
| Google Calendar                               | `google-calendar`        | Apps                                            |
| Google Cloud BigQuery                         | `google-bigquery`        | Apps                                            |
| Google Drive                                  | `google-drive`           | Apps                                            |
| HyperFrames by HeyGen                         | `hyperframes-heygen`     | Apps                                            |
| Interactive Brokers (IBKR)                    | `interactive-brokers`    | Apps                                            |
| Linear                                        | `linear`                 | Apps                                            |
| Meltwater                                     | `meltwater`              | Apps                                            |
| Microsoft Teams                               | `ms-teams`               | Apps                                            |
| Mixpanel                                      | `mixpanel`               | Apps                                            |
| Notion                                        | `notion`                 | Apps                                            |
| OneDrive                                      | `onedrive`               | Apps                                            |
| Outlook Mail                                  | `outlook`                | Apps                                            |
| Outlook Calendar                              | `outlook-calendar`       | Apps                                            |
| Salesforce                                    | `salesforce`             | Apps                                            |
| S&P Global                                    | `sp-global`              | Apps                                            |
| SharePoint                                    | `sharepoint`             | Apps                                            |
| Stripe                                        | `stripe`                 | Apps                                            |
| Vercel                                        | `vercel`                 | Apps                                            |
| Webull                                        | `webull`                 | Apps                                            |
| Wix                                           | `wix`                    | Apps                                            |
| Custom MCP connectors (bring your own server) | `custom-mcp`             | Apps                                            |
| Granola                                       | `granola`                | Apps                                            |
| Tana                                          | `tana`                   | Apps                                            |
| Slack                                         | `slack`                  | Apps                                            |
| Plaid                                         | `plaid`                  | Finances; production/security approval required |
| Oura                                          | `oura`                   | Health; eligible developer accounts required    |
| Apple Health                                  | `apple-health`           | iOS companion, signing and device consent       |
| Android Health Connect                        | `android-health-connect` | Android companion, signing and device consent   |

A catalog entry alone never enables OAuth, provider calls, account access, trading, payments, or billing. Production configuration, provider eligibility, a working adapter, explicit account consent, token refresh and an end-to-end read must be verified before a connector is called live. New entries have no invented permission contracts. Generic local icons are used when verified brand assets are unavailable.

| Rollout dependency                                    | Providers                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated Google flows                                | Gmail, Google Drive, Google Calendar                                                                                                                                   |
| Work-app reads with provider setup and consent        | Box, Calendly, Canva, Figma, Gamma, GitHub, BigQuery, Linear, Microsoft Teams, Notion, OneDrive, Outlook Mail, Outlook Calendar, Salesforce, SharePoint, Slack, Stripe |
| User credential and provider acceptance               | eToro, Granola, HyperFrames by HeyGen, Meltwater, Mixpanel, Vercel                                                                                                     |
| Finance or health setup and consent                   | Plaid, Oura                                                                                                                                                            |
| Diagram file exchange                                 | Excalidraw                                                                                                                                                             |
| Dedicated account credentials and provider acceptance | Interactive Brokers, S&P Global, Webull, Wix                                                                                                                           |
| Hosted OAuth client and workspace consent             | Tana                                                                                                                                                                   |
| Approved server configuration and user bearer token   | Custom MCP connectors                                                                                                                                                  |
| Signing, distribution and on-device acceptance        | Apple Health, Android Health Connect                                                                                                                                   |

For the current work-app operations and acceptance checks, see [Work app connections](work-apps.md). Each operation needs its own permission verification. A read test verifies the tested read only. Availability of a provider write scope does not by itself implement or verify a Kova write operation.

On a deployment of this PR, the existing authenticated administrator endpoint `GET /api/admin/diagnostics` reports the 37 connector IDs and their deployment setup state. For blocked web connectors it lists server setting names to check. It does not return setting values, linked account data, provider responses, or proof of consent. Check the report on the intended public host so callback-origin and Tana public-client checks use that host. For web connectors marked ready for account verification, use a dedicated test account to confirm the supported operations, denial and revocation. Verify the file exchange and both native companions separately.

Custom MCP connects deployment-approved HTTPS servers using user-supplied bearer credentials. Each registration identifies a reviewed read tool and can also identify an optional reviewed write tool. Changing an endpoint or tool requires linking the relevant permission again. See [Custom MCP acceptance](work-apps.md#custom-mcp-acceptance).

The existing launch review preview still covers its original 12 providers. The production Apps directory uses the complete master catalog. Bank and health entries point out their dedicated setup requirements; adding them does not create a web OAuth flow.

Outlook Calendar has a read implementation through the selected Microsoft account. It uses `Calendars.Read` (or an existing `Calendars.Read`/`Calendars.ReadWrite` grant), searches subject prefixes in the default calendar, and returns at most ten event titles, start/end times and links. Series masters are included; recurring instances are not expanded. Mail-only access cannot enable this search. If Microsoft rejects the subject filter, Kova checks at most 50 events from the default calendar and returns only matching prefixes. Event creation is a separate reviewed operation with an explicit Calendars.ReadWrite grant. Deployment and a real provider read are still required before calling it live.

Official implementation references: [Microsoft Graph v1.0 list events](https://learn.microsoft.com/en-us/graph/api/user-list-events?view=graph-rest-1.0) and Microsoft's [subject-prefix filter example](https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/bb35043c742d4406d73ccae904c05fbfca7c7428/api-reference/v1.0/includes/snippets/python/calendar-list-events-filteronsubject-python-snippets.md).
