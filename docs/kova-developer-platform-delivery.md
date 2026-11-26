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
- Purchased developer credits must be a separate balance/ledger bucket. Consume eligible included credits first, then purchased credits only within the customer's configured budget. Never reset purchased credits at subscription renewal; each purchased lot follows its own expiry below.
- All grants, expiry, reservations, usage settlement, adjustments and releases must be atomic, auditable and idempotent; preserve original funding bucket on releases. Explicitly handle in-flight usage crossing expiry, duplicate/out-of-order subscription events, downgrade, cancellation, refunds, disputes and multiple workspaces. A refund or plan change must not create a second grant.
- Verify subscription status on the server against the established payment authority, not user metadata or a client-supplied plan. Reconcile against actual provider usage; enforce account/project/key limits and zero-balance rejection before provider dispatch.
- No Stripe charge, live credit grant, SQL migration or activation is authorized by this design document. Coordinate with consumer credits PR #774; do not conflate its wallet with developer API credits. Review upstream cost and gross margin before launch.

## Purchased API credits and optional KovaGPT usage

Owner clarification, 2026-11-26: purchased API credits expire one year after purchase and can optionally fund KovaGPT consumer usage. This setting is off by default.

- Track each confirmed purchase as a distinct credit lot with original amount, remaining amount, purchase timestamp, and expiry one calendar year after purchase (UTC; define and test leap-day handling). Subsequent purchases, auto-reload, sign-in, setting changes, or internal allocation must never extend an existing lot's expiry. Pending or failed payments create no spendable credits.
- Expire only unspent value from the specific lot. Apply earliest-expiring eligible purchased lots first after included API allowance for API requests. Preserve expiry and original funding provenance for refunds, reservation releases and reconciliation. Show expiry dates, expiring amounts and purchase history in Billing. Review applicable prepaid-credit terms and consumer protection requirements before commercial activation.
- Add a server-persisted account setting, "Use purchased API credits for KovaGPT usage", default false for new and existing accounts. Expose it in KovaGPT Settings > Usage and developer Billing; both surfaces read and write the same verified user's setting. Explain that enabling it allows eligible paid over-limit consumer usage to draw from purchased API credits.
- Proposed spending order: consumer plan allowance first, then existing consumer usage wallet, then eligible purchased API credits only when the setting is enabled. Do not spend or convert the included monthly Pro API allowance on consumer usage. Do not automatically purchase credits or enable auto-reload through this toggle; those require separate explicit settings.
- Use a shared atomic authorization/reservation/settlement boundary across API and consumer spending so the same purchased balance cannot be spent twice. No duplicate wallet credit, copying of balances, or transfer that resets expiry. Apply the established consumer usage price, cost floor, user budget and limits. If disabled, insufficient, expired, or unauthorized, fall back to the existing consumer behavior without charging API credits.
- Disabling the setting blocks new consumer reservations immediately; already authorized in-flight reservations reconcile against the original lot. Record every debit with surface, model/service, purchase lot and request identity. Show both API and KovaGPT usage in transaction history and prevent cross-account or cross-organization spending.
- Coordinate integration with PR #774 before release. Add tests for one-year expiry per lot, staggered purchases, toggle default/persistence/revocation, opt-in/opt-out, included-credit isolation, insufficient funds, simultaneous API/consumer reservations, replay, and refund/expiry reconciliation.

## Required independently navigable product surfaces

| Group | Pages |
| --- | --- |
| Workspace | Overview, organization switcher, project switcher, project settings |
| Playground | Text/Responses, images, audio, agents, saved prompts |
| Models | Searchable catalog, model details, supported reasoning levels, capabilities and pricing |
| Development | API keys, service accounts, projects, logs, request details, webhooks |
| Resources | Files, vector stores, containers, agent runs, browser sessions |
| Usage | Spend, requests, tokens and per-service meters; filter by project, model, key and date |
| Billing | Balance, included Pro allowance and renewal date, purchased credits and lot expiry, KovaGPT usage opt-in, auto-reload, payment methods, invoices, transaction history, limits |
| Settings | Profile, organization, members, roles, permissions, security |
| Documentation | Overview, quickstart, authentication, API reference by service, guides, SDKs, examples, errors, limits, pricing, status, changelog |

First increment: dedicated responsive console shell and real existing account/project/key/recent-call metrics, with anchors to already implemented controls. Do not advertise the anchors as separate completed pages. Follow with real routes, loading/error/empty states, accessible navigation, server-backed actions and responsive visual acceptance. Use the main Kova typography and existing light/dark theme tokens. Do not populate dashboards with fabricated spend or request data.

## Developer experience parity and explicit exclusions

Owner clarification, 2026-11-26: offer the viewing options, spending options, analytics and account settings of a complete developer platform. Use the current OpenAI API Platform as a functional reference, not a promise of identical upstream services or an exact visual clone.

- Analytics and activity: independent Usage, Costs and Logs views, UTC date range and time granularity, organization/project/key/model/service/status filters, request and token counts, cache/other metered dimensions where applicable, time-series charts, breakdowns, pagination and CSV export. Separate finalized charges from pending reservations and do not sum different currencies. Never use a recent-call sample as a full billing-period total.
- Spending: wallet and lot history, monthly included allowance, purchased balances/expiry, explicit auto-recharge thresholds and caps, invoices/receipts, payment methods, project/account/key spending and concurrency limits, configurable alerts and model/service access. Clearly distinguish hard limits from notifications. Any charge or external payment action requires appropriate authority.
- Settings: organization and project lifecycle, profile, members and roles, key scope/revocation, security, usage-sharing opt-in, privacy and data retention. Keep developer credentials distinct from consumer sessions while reusing the same verified account.
- No complimentary usage, daily free tokens, promotional credits or model discounts in exchange for sharing prompts, outputs, evaluations or training data, including small models. The explicit paid Pro monthly USD 80 allowance is independent of data sharing. Do not make data sharing a condition of API access or automatically enroll users in training.
- Full page coverage is not complete until each route is accessible directly and has verified, server-backed functionality, or is clearly identified as unavailable. Do not ship simulated dashboards or pretend missing actions work.

Current increment: twelve URL-selectable console views (overview, playground, projects, keys, models, files, usage, costs, logs, billing, limits, settings); compact phone navigation, mobile request-history cards, responsive controls and reduced panel padding; same-account auto-selection; scoped-key text/image/embedding playground with signed quote confirmation; owner-scoped paginated request filters; observed date-range analytics and full filtered CSV export for up to 93 days and 5,000 records. Workspace provisioning, project creation/rename and the default-off persistent sharing preference are implemented in staged SQL and server/UI code behind KOVA_DEVELOPER_WORKSPACE_V2. Credit-lot tables, direct active monthly Pro allowance, one-year purchase expiry, original-lot reservation/settlement and refund/dispute reconciliation are staged in supabase/pending/developer_credit_lots_v2.sql. Atomic adapters for the existing API admission/dispatch/finish/recovery and verified funding receipt code are staged in developer_credit_lot_integration_v2.sql and wired behind KOVA_DEVELOPER_CREDIT_LOTS_V2. Neither flag is activated. Legacy wallets with any financial history require explicit evidence-backed reconciliation before lot activation; the write fence prevents older revisions silently mutating tracked monetary balances. Consumer opt-in is persisted but no consumer billing fallback calls the lot engine yet. Both flags require CLI migration materialization, release manifest regeneration, isolated replay and authenticated browser acceptance. No real charges, grants, schema mutations or deployment have occurred.

## API coverage

Inventory all approved text models, aliases, supported effort levels, image generation/editing, embeddings, audio/voice, vision, search/research, hosted tool calling, agents, browser, analysis/containers, decisions, moderation, files/vector stores, webhooks and MCP. Map each to a real server capability, approved provider contract, scoped key permission, request validation, metering, limits, documentation and isolated test. A provider-backed alias is not a separately trained foundation model. Do not publish unsupported models or capabilities as available.

## Release gates

- Two-account isolation for all API resources and credit balances; no separate account link.
- First visit and repeated/concurrent provisioning; existing developer-account adoption without duplicate ownership or balance.
- Pro allowance grant, repeat login, renewal, expiry, concurrent reservation/settlement, duplicate event, downgrade/refund and paid-credit preservation.
- Each public endpoint: valid request, wrong scope, invalid input, rate/budget limit, provider error, cancellation, retry/idempotency and accurate usage settlement.
- Responsive light/dark visual acceptance, keyboard navigation, direct route navigation, no dead links or inert actions.
- Required CI green on exact release SHA, database migration validation/replay where applicable, controlled production verification with explicit approval before any live paid charge, and rollback-safe deployment.

## Credit-lot integration release blockers

- Verify the staged SQL and full existing migration chain in an isolated database; exercise exact production admission, dispatch including file bindings, recovery, funding and reversal adapters, not just the isolated policy fixture. The new database tests are committed but have not run.
- Verify the direct paid Pro period authority and payment timestamp contract; distinguish included-credit face-value usage from realized revenue and account for the $80 subsidy in gross-margin reporting. Reconcile existing paid credit history from original payment evidence; never seed unexplained opening balances. Show the included and purchased balances, renewal and per-lot expiration in Billing.
- Make periodic renewal/expiry maintenance and same-account wallet refresh transactional, including multiple tracked workspaces and downgrade, refund, deletion and suspension cases. Verify an account can recover from an interrupted rollout without reverting to the old unguarded monetary path.
- Integrate the final #774 consumer allowance and wallet admission/settlement contract with the same account and lot transaction boundary, including exact quote/cap enforcement, idempotency and cancellation. Do not activate consumer spending before that is verified.
- Complete the remaining public service endpoints, independent platform pages, pricing approval, and full mobile/desktop CI and actual provider acceptance. No service should be represented as working based only on staged code.
