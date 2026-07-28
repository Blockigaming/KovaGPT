# Project Constellation live ChatGPT app parity

## Verification result

An official inventory verification was attempted on **2026-07-27 at 20:30:29 UTC** against the live ChatGPT Apps directory and OpenAI's Apps help article. Both official OpenAI endpoints were blocked by the execution environment's outbound proxy with HTTP 403. Search tooling was also unavailable. Consequently, the repository does **not** claim a verified official inventory count.

The exact-parity manifest therefore fails closed with **0 activated parity entries**, `lastVerifiedAt: null`, and status `official_directory_unavailable`. This is not a claim that ChatGPT has zero apps. It prevents a guessed or stale list from being labeled exact parity. Provider adapters built by Constellation are kept in the separate **Kova Extensions** provider list and do not inflate the parity count.

## Activation procedure

Before release, an operator with access to the official directory must:

1. Capture the current directory inventory, plan/region visibility, public identifiers, and each official listing URL.
2. Populate `CHATGPT_PARITY_APPS` only from those official records.
3. Record the exact UTC verification timestamp and OpenAI source URL per entry.
4. Run the manifest integrity tests and review changes against the previous snapshot.
5. Activate only Kova adapters whose OAuth, retrieval/actions, health, refresh, disconnect, provider revocation, failure handling, and tests are all complete.

## Kova Extensions implementation inventory

This is deliberately **not** the ChatGPT parity collection.

| Provider family | Services                                                    | State after credentials                                                                  | External requirement                                                        |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Google          | Drive, Gmail, Calendar                                      | Operational in the existing Google implementation                                        | Google OAuth production credentials                                         |
| Microsoft       | OneDrive, SharePoint, Outlook Mail, Outlook Calendar, Teams | Generic OAuth account linking becomes operational; service tools and sync remain blocked | Entra application, admin consent where required, Graph API approval         |
| GitHub          | Repositories and organizations                              | OAuth account linking becomes operational                                                | GitHub OAuth/App approval; repository tool adapter remains required         |
| Slack           | Workspace search and messaging scopes                       | OAuth account linking becomes operational                                                | Slack app review/install; Events and tool adapters remain required          |
| Notion          | User-authorized workspace pages                             | OAuth account linking becomes operational                                                | Public Notion integration approval; page sync/tool adapter remains required |
| Linear          | Workspace issues                                            | OAuth account linking becomes operational                                                | Linear OAuth application; GraphQL tool adapter remains required             |
| Dropbox         | Files                                                       | OAuth account linking becomes operational                                                | Dropbox app approval; content/sync adapter remains required                 |
| Box             | Files                                                       | OAuth account linking becomes operational                                                | Box application/enterprise consent; content/sync adapter remains required   |

No provider in this table is called a complete connector merely because account linking is credential-ready.
