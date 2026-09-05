# Developer pricing administration

`/developers/pricing` is a restricted source-level administration surface. The server authorizes the current Auth user against `KOVA_ADMIN_USER_IDS`, checks the captured principal on every request, and rejects deleted or banned accounts. The page clears its private draft and aborts pending work when saved browser data is cleared or the principal changes.

No commercial rates, credit offers, identities, Stripe objects or runtime activation are created by this package. Apply the repository migrations and configure trusted administrator access only during an owner-approved release. The existing developer runtime and funding gates remain separate.

## Exact review and approval

1. Choose **Developer pricing** or **Prepaid credit offer** and enter a proposal JSON object.
2. **Validate and save draft** runs the production quote validator, saves canonical bytes and displays their SHA-256. Saving has no billing effect.
3. Review the saved terms, evidence, maximum request bounds, preview charges and expiry. Editing requires another save and clears the review checkbox.
4. **Approve this exact revision** sends the displayed revision and hash. A concurrent edit rejects approval. Approval is atomic and idempotent; its immutable output is eligible only for a separately enabled runtime.
5. Retiring requires a reason and the same exact revision/hash. It disables new use without rewriting prior accepted quotes, financial receipts or purchased credits. Reactivation requires a new reviewed proposal.

All numeric amounts are in the currency's minor units; a rate per 1,000 tokens is `unit_price / unit_quantity` per token. No conversion from a provider's published currency or units is inferred.

## Pricing proposal schema

The top-level object contains `version` and `registry`. Unknown fields are rejected.

`version` requires:

| Field                                          | Meaning                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                                      | Unique positive integer version number                                                                                                 |
| `currency`                                     | Three uppercase currency letters                                                                                                       |
| `margin_floor`                                 | Reviewed fraction from 0.5 to below 1, at most five decimal places                                                                     |
| `risk_buffer_percentage`                       | Explicit fraction from 0 to 1, at most five decimal places                                                                             |
| `minimum_request_charge`, `rounding_increment` | Positive reviewed minor-unit amounts, at most eight decimal places                                                                     |
| `effective_at`, `expires_at`                   | ISO timestamps; expiry must cover the effective period, be current and no more than 90 days ahead                                      |
| `allowance_configuration`                      | `fixed` and `percentages` maps, plus explicit `collectionPercentage` and `collectionFixed`; includes every reviewed variable allowance |
| `public_price_configuration`                   | `{ "contracts": [...] }` with at most 64 contracts                                                                                     |

Each contract requires `provider` (`azure_openai` or `openai`), exact final `upstreamModel` deployment, `publicModel`, `capability`, `meter`, `maximumUsage` and `maximumRequestBytes`. Non-image contracts require `expectedResponseModels` matching actual provider response identities. Supported meters are `responses_tokens`, `embedding_tokens` and `image_tokens`; usage dimensions must exactly match the production meter. Image contracts also require `maximumImages`, `allowedSizes` and `allowedQualities`. No provider URL, hosted tool billing guess or unbounded output is accepted.

Every `registry` row requires `provider`, `upstream_model`, `billing_dimension`, `unit`, positive `unit_quantity`, nonnegative `unit_price`, matching `currency`, `source`, `effective_at`, `expires_at`, and `evidence`. Evidence requires a review `reference`, the source evidence's 64-character SHA-256, and `verifiedAt` within the last 90 days. Registry periods must cover the complete version period. Supply exactly one row per used provider/model/dimension; unrelated rows and duplicate dimensions are rejected.

Approval creates immutable registry IDs and embeds their exact set in the approved version. Both the public quote and last-mile meter query only those IDs. An older version without an exact registry binding fails closed and needs explicit owner review through this workflow. A more recent, unrelated rate row cannot silently change an accepted version. Funding's recorded collection-cost floor can conservatively raise the allowance before a new quote; the customer still accepts that quote's exact maximum before dispatch.

## Prepaid credit offer schema

Required fields are `name`, `environment` (`sandbox` or `live`), `stripe_price_id`, `currency`, integer `subtotal_amount`, integer `credits_amount`, integer `refund_reserve`, integer `dispute_reserve`, integer `maximum_processor_fee`, `tax_mode` (`automatic` or `reviewed_exempt`), `tax_review_reference` and `expires_at`.

Credits and each individual reserve/fee allowance cannot exceed subtotal. The owner chooses the credit face value; the recorded collection-cost floor is recovered through subsequent reviewed cost-plus quotes. No amount, tax exemption, processor fee or reserve is assumed. The expiry is bounded to 90 days. Approval performs read-only Stripe checks: the exact active one-time Price and Product, fixed quantity/unit amount, matching environment/currency, and supported default settlement currency. Automatic tax requires exclusive tax behavior, an existing Product tax code, active Tax settings and an active registration. An explicit owner tax-review reference is still required. These checks do not determine which jurisdictions or tax codes are legally appropriate.

The reusable `verifyConfiguredCreditOffer` is also called before opening new Checkout sessions so stale provider configuration does not silently bypass the reviewed contract. Previously created sessions continue to reconcile even after an offer is retired.

## Verification and manual boundary

Executable tests cover canonical hashes, stale revision rejection, duplicate approvals, exact rate bindings, immutable approved rows, retirement, deletion fences, malformed monetary terms, unsupported FX, provider identity and tax-readiness failures. SQL tests run with service role and no direct Auth-table SELECT. Test prices and evidence are fixtures only.

The owner must provide and approve the commercial terms, fresh upstream evidence, processor/reserve ceilings, settlement currency and tax treatment. Provider credentials, tax registrations and deployment activation remain owner-controlled. No live approval or Stripe mutation is part of source preparation.
