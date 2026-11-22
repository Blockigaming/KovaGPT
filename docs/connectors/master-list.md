# KovaGPT connector master list

The Apps directory includes the 31 requested services and seven retained services. WHOOP is also tracked in Health. Existing catalog IDs remain stable. Outlook Mail uses `outlook`.

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
| HubSpot                                       | `hubspot`                | Apps                                            |
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
| WHOOP                                         | `whoop`                  | Health; eligible developer accounts required    |
| Apple Health                                  | `apple-health`           | Native mobile implementation required           |
| Android Health Connect                        | `android-health-connect` | Native mobile implementation required           |

A catalog entry alone never enables OAuth, provider calls, account access, trading, payments, or billing. Production configuration, provider eligibility, a working adapter, explicit account consent, token refresh and an end-to-end read must be verified before a connector is called live. New entries have no invented permission contracts. Generic local icons are used when verified brand assets are unavailable.

| Rollout dependency                                   | Providers                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated Google flows                               | Gmail, Google Drive, Google Calendar                                                                                                                                            |
| Work-app reads with provider setup and consent       | Box, Calendly, Canva, Figma, Gamma, GitHub, BigQuery, HubSpot, Linear, Microsoft Teams, Notion, OneDrive, Outlook Mail, Outlook Calendar, Salesforce, SharePoint, Slack, Stripe |
| Personal API key and provider acceptance             | Granola, HyperFrames by HeyGen                                                                                                                                                  |
| Finance or health setup and consent                  | Plaid, Oura, WHOOP                                                                                                                                                              |
| Provider adapters still needed                       | eToro, Excalidraw, Interactive Brokers, Meltwater, Mixpanel, S&P Global, Tana, Vercel, Webull, Wix                                                                              |
| MCP registration and tool authorization still needed | Custom MCP connectors                                                                                                                                                           |
| Native clients and on-device consent still needed    | Apple Health, Android Health Connect                                                                                                                                            |

For the current work-app operations and acceptance checks, see [Work app connections](work-apps.md). Each operation needs its own permission verification. A read test verifies the tested read only. Availability of a provider write scope does not by itself implement or verify a Kova write operation.

Custom MCP means bring your own server. Registration, per-server authentication, tool review, network protections and account isolation must be implemented before enabling arbitrary servers.

The existing launch review preview still covers its original 12 providers. The production Apps directory uses the complete master catalog. Bank and health entries point out their dedicated setup requirements; adding them does not create a web OAuth flow.

Outlook Calendar has a read implementation through the selected Microsoft account. It uses `Calendars.ReadBasic` (or an existing `Calendars.Read`/`Calendars.ReadWrite` grant), searches subject prefixes in the default calendar, and returns at most ten event titles, start/end times and links. Series masters are included; recurring instances are not expanded. Mail-only access cannot enable it, and the implementation makes no event changes. Deployment and a real provider read are still required before calling it live.

Official implementation references: [Microsoft Graph v1.0 list events](https://learn.microsoft.com/en-us/graph/api/user-list-events?view=graph-rest-1.0) and Microsoft's [subject-prefix filter example](https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/bb35043c742d4406d73ccae904c05fbfca7c7428/api-reference/v1.0/includes/snippets/python/calendar-list-events-filteronsubject-python-snippets.md).
