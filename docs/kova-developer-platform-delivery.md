# Kova developer platform — delivery contract

Owner direction, 2026-11-26: build a complete paid public API for Kova models and services, use the first clean sidebar/dashboard layout as the reference, share the main KovaGPT sign-in, and include USD 80 of non-rollover monthly API credits for Pro members.

## Identity and account provisioning

- Use the existing verified KovaGPT session and immutable account UUID through the current server authorization boundary. Do not introduce a second login, password, identity provider, or email-based account link.
- Automatically create or resolve exactly one personal developer workspace and USD credit account per eligible signed-in identity on the server. Make provisioning idempotent and race-safe; preserve existing organizations, projects, and keys. Never accept user UUIDs or subscription tiers as client authority.
- Keep developer API keys distinct from web sessions; scoped, hashed, revocable credentials and per-project authorization remain mandatory.
- Prefer the existing /developers routes and origin until a separately approved custom-domain/session design is verified. No cross-domain cookie widening as a shortcut.

## Included Pro API credits

- USD 80 face value each monthly paid Pro subscription period, automatically associated with that same account. No manual claim or account-link step. No carryover, cash redemption, gift, or transfer.
- Proposed period definition: authoritative paid subscription billing period (not browser time or calendar month). At renewal expire the unused balance and grant at most one new USD 80 allowance for the new eligible period. Confirm billing-period edge cases before enabling.
- Purchased developer credits must be a separate balance/ledger bucket. Consume eligible included credits first, then purchased credits only within the customer's configured budget. Never reset purchased credits at renewal.
- All grants, expiry, reservations, usage settlement, adjustments and releases must be atomic, auditable and idempotent; preserve original funding bucket on releases. Explicitly handle in-flight usage crossing expiry, duplicate/out-of-order subscription events, downgrade, cancellation, refunds, disputes and multiple workspaces. A refund or plan change must not create a second grant.
- Verify subscription status on the server against the established payment authority, not user metadata or a client-supplied plan. Reconcile against actual provider usage; enforce account/project/key limits and zero-balance rejection before provider dispatch.
- No Stripe charge, live credit grant, SQL migration or activation is authorized by this design document. Coordinate with consumer credits PR #774; do not conflate its wallet with developer API credits. Review upstream cost and gross margin before launch.

## Required independently navigable product surfaces

| Group | Pages |
| --- | --- |
| Workspace | Overview, organization switcher, project switcher, project settings |
| Playground | Text/Responses, images, audio, agents, saved prompts |
| Models | Searchable catalog, model details, supported reasoning levels, capabilities and pricing |
| Development | API keys, service accounts, projects, logs, request details, webhooks |
| Resources | Files, vector stores, containers, agent runs, browser sessions |
| Usage | Spend, requests, tokens and per-service meters; filter by project, model, key and date |
| Billing | Balance, included Pro allowance and renewal date, purchased credits, auto-reload, payment methods, invoices, transaction history, limits |
| Settings | Profile, organization, members, roles, permissions, security |
| Documentation | Overview, quickstart, authentication, API reference by service, guides, SDKs, examples, errors, limits, pricing, status, changelog |

First increment: dedicated responsive console shell and real existing account/project/key/recent-call metrics, with anchors to already implemented controls. Do not advertise the anchors as separate completed pages. Follow with real routes, loading/error/empty states, accessible navigation, server-backed actions and responsive visual acceptance. Use the main Kova typography and existing light/dark theme tokens. Do not populate dashboards with fabricated spend or request data.

## API coverage

Inventory all approved text models, aliases, supported effort levels, image generation/editing, embeddings, audio/voice, vision, search/research, hosted tool calling, agents, browser, analysis/containers, decisions, moderation, files/vector stores, webhooks and MCP. Map each to a real server capability, approved provider contract, scoped key permission, request validation, metering, limits, documentation and isolated test. A provider-backed alias is not a separately trained foundation model. Do not publish unsupported models or capabilities as available.

## Release gates

- Two-account isolation for all API resources and credit balances; no separate account link.
- First visit and repeated/concurrent provisioning; existing developer-account adoption without duplicate ownership or balance.
- Pro allowance grant, repeat login, renewal, expiry, concurrent reservation/settlement, duplicate event, downgrade/refund and paid-credit preservation.
- Each public endpoint: valid request, wrong scope, invalid input, rate/budget limit, provider error, cancellation, retry/idempotency and accurate usage settlement.
- Responsive light/dark visual acceptance, keyboard navigation, direct route navigation, no dead links or inert actions.
- Required CI green on exact release SHA, database migration validation/replay where applicable, controlled production verification with explicit approval before any live paid charge, and rollback-safe deployment.
