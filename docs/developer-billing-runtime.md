# Developer billing runtime

This is source preparation, not a public API launch or a change to subscription billing. `KOVA_DEVELOPER_BILLING_ENABLED=false` is the default. No prices, funded accounts, enabled keys or limits are seeded. Consumer `acquireGeneration` / `finalizeGeneration` protection remains unchanged.

The common provider transport now meters every invocation made inside `withDeveloperBilling({ keyId, requestKey }, callback)`. Only authenticated server-side developer-key middleware may enter that context. The callback must use the existing provider facade; it must never construct a context from claimed account, price, usage or allowance fields in an HTTP request. The current repository still needs the public developer-key ingress. Without the context, current consumer routes retain their existing behavior.

## Required server-owned contract

An enabled, unexpired `developer_billing_keys` row selects its funded credit account, organization and project. Explicit per-request, UTC-day, UTC-month and concurrency limits are required at all three scopes: key, project, organization. Missing limits, revoked keys, suspended accounts, expired prices and emergency controls fail closed before provider dispatch. The migration creates these tables without inserting an active configuration.

An approved `api_pricing_versions` row requires a real approving administrator, approval date, effective date and expiry. `allowance_configuration` must explicitly contain `fixed`, `percentages`, `collectionPercentage` and `collectionFixed`; no guessed fee is supplied. Risk buffer, minimum charge, rounding increment and a margin floor of at least 50% must also be approved.

`public_price_configuration.contracts` contains reviewed records with `provider`, `upstreamModel`, `publicModel`, `capability`, `meter`, `maximumRequestBytes` and `maximumUsage`. Bounds must cover the actual provider contract, including context and output limits. Text request bytes must fit within the approved input-token bound. Responses and embeddings contracts require an `expectedResponseModels` allowlist and settlement rejects mismatched model identity. Image contracts require `maximumImages`, `allowedSizes` and `allowedQualities`; mixed image/text output-token charging requires a separate verified meter. Supported meters are:

| Meter              | Required maximum usage dimensions                      | Authoritative response                                                                     |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `responses_tokens` | `input_tokens`, `cached_input_tokens`, `output_tokens` | Completed/incomplete Responses usage; cached input is subtracted from total input          |
| `embedding_tokens` | `input_tokens`                                         | Embeddings `usage.prompt_tokens` and provider request identifier                           |
| `image_tokens`     | `input_tokens`, `image_input_tokens`, `output_tokens`  | Image usage text/image input breakdown and output tokens, with provider request identifier |

Each dimension needs an active, approved, effective, expiring `upstream_price_registry` record in the account currency. Values are minor currency units. Actual Azure deployment/model identity and the provider's real billable dimensions must be confirmed before activation. Hosted tools and multimodal inputs in token-only Responses requests are rejected: those capabilities need a separately verified complete charging contract. No model routing changes are made.

The request stores its accepted pricing version, rate/allowance snapshot, maximum charge, server-computed body fingerprint and scope limits. It never stores prompts, response text, image bytes or credential values in the billing ledger. Provider output is passed through a bounded accounting-field collector; SSE accounting frames have a 1 MiB bound. Oversized/malformed/missing authoritative usage becomes an uncertain charge, not invented usage.

## Atomic lifecycle

Admission, dispatch permission, settlement and recovery share one database lock order. The unused legacy standalone reservation RPC is no longer executable by the service role. Duplicate idempotency keys do not dispatch again; a changed request conflicts. A new external request may make at most 16 metered provider calls. Every call reserves its own maximum charge before dispatch. Scope request limits also cover the sum of holds and settled charges across the complete outer request, so multiple provider calls cannot bypass the per-request cap.

Undispatched failure or cancellation releases the hold. Once dispatch permission is recorded, a network error, timeout, HTTP rejection, missing usage or early cancellation retains the hold and creates a reconciliation alert. These failures are not proof that the provider charged nothing. A definitive terminal usage event permits settlement even if the client then cancels. Successful settlement uses accepted rates and authoritative usage, returns unused credit, and never increases the accepted maximum charge.

A verified margin shortfall records the actual costs, raises an alert and blocks new calls to the affected model. Financial entries remain immutable. The ledger records reservation, release of the hold and the final debit atomically, so its balance changes conserve funds. Gross margin values below the legacy column's representable minimum remain null; actual costs and profit remain recorded and the below-floor flag/emergency block still apply.

`POST /api/internal/developer-billing` accepts no body or query and requires the independent `DEVELOPER_BILLING_WORKER_SECRET`. It recovers at most 100 expired rows per call: expired undispatched reservations are released, while dispatched outcomes enter `reconciliation_required`. This maintenance remains available when paid generation is disabled. Operators listed in `KOVA_ADMIN_USER_IDS` receive deduplicated private in-app alerts. `GET /api/admin/developer-billing` uses the existing administrator allowlist and exposes bounded diagnostics without tokens or prompts.

Uncertain provider outcomes are not automatically refunded or guessed. Service-only finalization supports later authoritative reconciliation; collecting authoritative provider receipts for unknown outcomes requires the actual provider billing/receipt contract. Neither the maintenance endpoint nor a client route accepts user-supplied final usage. Public API ingress, credit purchasing, pricing-administration UI and any provider-specific receipt importer are separate follow-on source packages.

## Activation evidence still required

Owner/operator decisions are the verified provider rates and receipt source, actual processing/infrastructure/risk allowances, funded account and scope budgets, approved customer pricing, scheduler secret/invocation, matching migration/deployment and live provider/credit canary. Do not enable billing or create live charges from these source tests.

Tests exercise duplicate/concurrent admission, scope limits, balance conservation, terminal idempotency, expiry, emergency and key revocation, missing prices, role isolation without `auth.users` SELECT, consumer/developer context separation, bounded response accounting, cancellation and ledger failures.

Provider field references: [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Embeddings](https://developers.openai.com/api/reference/resources/embeddings), [Images](https://developers.openai.com/api/reference/resources/images). No current live rates are embedded.
