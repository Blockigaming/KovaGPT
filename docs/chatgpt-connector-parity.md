# ChatGPT connector parity — Project Nexus

Audit date: **2026-07-27**. ChatGPT now presents integrations as Apps; availability varies by plan, region, administrator policy, and the live app directory. This report therefore separates a connector family from the entitlement that makes it visible.

## Production status

| ChatGPT app / connector family  | KovaGPT status                                | What is real today                                                                         | Remaining dependency                                                                |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Google Drive                    | **Already implemented**                       | Google OAuth, scope consent, token status, reconnect, revoke, and Drive-backed use in chat | None beyond deployment OAuth credentials                                            |
| Gmail                           | **Already implemented**                       | Same linked Google account with Gmail-specific consent and chat handoff                    | None beyond deployment OAuth credentials                                            |
| Google Calendar                 | **Already implemented**                       | Same linked Google account with Calendar-specific consent and chat handoff                 | None beyond deployment OAuth credentials                                            |
| Microsoft SharePoint / OneDrive | **OAuth + backend needed**                    | No connector is exposed                                                                    | Microsoft Entra app, tenant consent, encrypted token vault, Graph sync/indexing     |
| Outlook Mail / Calendar         | **OAuth + backend needed**                    | No connector is exposed                                                                    | Microsoft Entra app, Graph scopes, encrypted token vault                            |
| Microsoft Teams                 | **OAuth + provider API needed**               | No connector is exposed                                                                    | Microsoft Entra/Graph integration and tenant administrator consent                  |
| Dropbox                         | **OAuth + backend needed**                    | No connector is exposed                                                                    | Dropbox app credentials, encrypted tokens, index and webhook workers                |
| Box                             | **OAuth + backend needed**                    | No connector is exposed                                                                    | Box app credentials, enterprise consent, encrypted tokens, indexing                 |
| GitHub                          | **OAuth + provider API needed**               | No connector is exposed                                                                    | GitHub App installation flow, repository permissions, encrypted tokens              |
| Slack                           | **OAuth + provider API needed**               | No connector is exposed                                                                    | Slack app review, workspace installation, scopes, event ingestion                   |
| Notion                          | **OAuth + provider API needed**               | No connector is exposed                                                                    | Notion public integration, page grants, encrypted tokens, sync                      |
| Linear                          | **OAuth + provider API needed**               | No connector is exposed                                                                    | Linear OAuth app, workspace scopes, encrypted token storage                         |
| HubSpot                         | **OAuth + provider API needed**               | No connector is exposed                                                                    | HubSpot public app approval, CRM scopes, encrypted token storage                    |
| Canva and other directory apps  | **Provider API needed**                       | Unsupported apps are intentionally absent                                                  | Provider partnership/API, reviewed OAuth application, tool contract                 |
| Custom MCP servers              | **Already implemented (client registration)** | MCP registry, capability/permission review, diagnostics and removal are available          | Remote execution and organization policy enforcement require backend infrastructure |

## Product rules

- `/apps` exposes only the four Google surfaces that have an end-to-end implementation; unsupported catalog entries never offer a decorative Connect button.
- Account linking is initiated by the server-owned Google OAuth flow and disconnection revokes the server-held grant.
- New OAuth connectors are not “frontend-feasible” in isolation: production support requires provider-issued client credentials, a server callback, encrypted refresh-token custody, webhook verification, per-user authorization, and data deletion/revocation handling.
- The connector catalog is not presented as a promise. A connector becomes visible only after its real adapter, OAuth configuration, health check, and revoke path exist.
