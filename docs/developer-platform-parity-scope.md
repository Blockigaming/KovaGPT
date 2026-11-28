# Developer platform parity scope

Reviewed November 26, 2026. This is the release acceptance backlog, not a claim of availability. Kova must implement the actual customer-facing API contracts, scoped permissions, data ownership, metering, documentation and usable UI for each supported capability. Do not expose session-authenticated consumer endpoints or proxy arbitrary upstream API requests.

## Reference

- [OpenAI API reference](https://developers.openai.com/api/reference/overview)
- [Tools](https://developers.openai.com/api/docs/guides/tools)
- [Projects and permissions](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)
- [Usage and costs](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs)
- [Agent architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture)

## Navigation and visual contract

Use the same account identity and shared Kova brand mark, font and color tokens as the consumer site. Preserve the native rounded pill buttons and selects, 14px inputs, 16px cards, 24px larger panels, and 44px mobile touch targets. Inactive navigation is transparent, with hover and active treatment from the shared sidebar tokens.

- Workspace: overview, playground, prompts, models, agents, sessions, files, vector stores, batches, containers, skills, integrations, webhooks.
- Analytics: usage, costs, logs, traces, service health, export.
- Manage: organizations, projects, members, service accounts, API keys, billing, limits, security, data controls, audit logs.
- Documentation: guides, API reference, pricing, SDKs, examples, changelog and status.

Only link to implemented screens. Do not display simulated data as customer data. The existing twelve console views are the starting point, not parity.

## Capability acceptance inventory

| Family               | Required coverage                                                                                                                           | Initial source status                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Text                 | Responses, streaming, structured output, function calls, reasoning controls, compatible chat interface                                      | Partial; existing Responses surface                             |
| Conversation state   | Conversations, items, response retrieval, cancellation, compaction and token counts                                                         | Not complete                                                    |
| Vision               | Image and supported document inputs                                                                                                         | Not complete                                                    |
| Images               | Generation, edits, model-specific streaming                                                                                                 | Partial; generation surface                                     |
| Embeddings           | Batch input and model dimensions                                                                                                            | Existing limited surface                                        |
| Audio                | Speech, transcription, translation, consent-aware voice controls                                                                            | Not complete                                                    |
| Live and realtime    | Authorized sessions, ephemeral credentials, events and supported audio transport                                                            | Not complete                                                    |
| Hosted tools         | Web research, file search, code execution, shell, computer use, MCP, deferred tool discovery, programmatic tool calls                       | Partial; MCP exists; hosted metering and public routes required |
| Decisions            | Dedicated decisions API and usage reporting                                                                                                 | Not complete                                                    |
| Agents               | Agent definitions, multi-agent execution, sessions, turns, artifacts, traces, event streams, environments, templates, scoped secret storage | Not complete                                                    |
| Automations          | Agent scheduling, invocations, pause, resume, cancellation                                                                                  | Not complete                                                    |
| Files                | Project-owned upload, list, read, delete, multipart upload, retention                                                                       | Partial; private text files                                     |
| Retrieval            | Vector stores, indexing, file batches, search, deletion                                                                                     | Not complete                                                    |
| Containers           | Isolated lifecycle, files, resource ceilings and retention                                                                                  | Not complete                                                    |
| Skills               | Versioned instruction bundles and lifecycle                                                                                                 | Not complete                                                    |
| Batch                | Submit, inspect, cancel, outputs and settlement                                                                                             | Not complete                                                    |
| Safety               | Moderation, provenance, restricted safety review                                                                                            | Not complete                                                    |
| Webhooks             | Endpoint management, signing, test delivery, retry, secret rotation                                                                         | Not complete                                                    |
| Application UI       | Embedded chat sessions and scoped thread lifecycle                                                                                          | Not complete                                                    |
| Model catalog        | List, detail, capabilities, pricing and eligibility                                                                                         | Partial; approved model listing                                 |
| Organization         | Membership, invitations, groups, roles, projects, archive, admin keys and service accounts                                                  | Partial; owner-scoped workspaces and keys                       |
| Security             | Audit logs, retention, certificates, workload identity, model and tool permissions; external storage and key configuration where supported  | Not complete                                                    |
| Limits               | Organization, project and key limits, alerts, supported service tiers and rate settings                                                     | Partial; existing spending controls                             |
| Analytics            | UTC usage and cost breakdowns by service, model, key, project, user, tier, batch; logs, traces and export                                   | Partial; historical console aggregation                         |
| Billing              | Verified prepaid purchases, payment history, invoices, reload, lot expiry, Pro allowance, refunds and consumer opt-in                       | Partial; existing funding and staged ledger                     |
| Developer experience | Versioned SDKs, endpoint schemas, examples, errors, request IDs, limits, pricing and status                                                 | Partial; existing reference pages                               |

Do not build a new dependency on discontinued or retiring upstream features. OpenAI's current fine-tuning and Evals notices describe wind-down; any Kova-native evaluation or customization workflow must be independently supported and verified, not a claim that the upstream legacy endpoint remains available. No training-data-sharing rewards or free-token incentive.

## Release acceptance

For each family require evidence of an actual route or documented SDK contract, authorization and two-account isolation tests, bounded requests and rate limits, approved provider capabilities and prices, atomic reservation and settlement where chargeable, retry/idempotency, usage and error reporting, and mobile/desktop light/dark browser tests for its console controls.

Retain the existing KovaGPT account and payment integration; no separate API signup. Production funding must use the approved KovaGPT live Stripe configuration and verified payment events, with account-holder authorization for activation and no live test charge without approval. Pro allowance is USD 80 per eligible paid period, no rollover; purchased credit lots expire after one calendar year. Consumer use of purchased API credit is opt-in, initially off, and excludes the included allowance.

A missing upstream capability or missing approved economics is a blocker, not permission to advertise a nonfunctional feature. Do not merge until canonical migrations, exact-head CI, provider contract tests, browser tests and deployment verification pass.
