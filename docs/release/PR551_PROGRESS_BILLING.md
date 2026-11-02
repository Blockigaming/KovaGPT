# PR551 progress and billing acceptance

## Included behavior

The main chat opts into an immediate SSE response. Public progress paragraphs and
activity rows arrive during context retrieval, web search, and connector reads;
the final answer follows on the same response. Stable operation IDs update rows
without hiding previous operations. Canceling the response aborts the underlying
request. Existing capture requests retain their original HTTP response contract.

Native search events identify each returned source and page opened by the
provider. Kova reports a found source as a found source, rather than claiming it
opened that page. Only hostnames are retained in progress. Known service logos
are local assets; other sites use a bounded fixed-provider favicon proxy, with a
globe fallback. Progress never contains tool arguments, page text, credentials,
full URLs, or private reasoning.

Work executions persist a public activity projection in the existing owner-scoped
event journal. The selected run refreshes this projection while work is running,
using a cursor, then stops at completion. Deploy the app and Work runner from the
same qualified source so newly executed steps include their public projection.

Billing and checkout fill the viewport. Pricing verifies the account before
starting checkout, directs existing subscriptions to their portal, and fences
late results after an account change. Embedded checkout reuses one session
initialization across renders. It does not automatically retry a payment attempt.

## Required billing release qualification

A read-only inspection of KovaGPT's live Stripe account on 2026-11-02 found the
approved active portal `bpc_1UB2ZxAEZlsb6DBYU3PoJJPU` allowed `quantity`, but not
`price`, in `features.subscription_update.default_allowed_updates`. That blocks
Plus/Pro switching. The two configured monthly USD prices are active and belong
to the expected products. No customer payment or plan was changed to inspect this.

During the authorized billing rollout, with the existing server-only restricted
key and approved portal ID bound in the operator environment, run:

```bash
node scripts/release/billing-portal-plan-change.mjs --review
node scripts/release/billing-portal-plan-change.mjs --apply
node scripts/release/billing-portal-plan-change.mjs --verify
```

The helper verifies the account and catalog, adds the two existing price choices,
and preserves other portal settings. It does not create prices, alter amounts,
change cancellation/proration/trial terms, create subscriptions, or make a payment.
`--verify` fails until both plan choices are configured. Keep the configured
portal ID and the compiled Stripe publishable key bound to the same account.

This PR does not enable the source-only monthly billing runtime or apply its
database migrations. Complete the existing approved monthly-policy migration,
webhook, recovery, and activation gates from the billing runbook before admitting
new live Checkout. A deliberate rollout block must not be bypassed as a UI fix.

## Acceptance before declaring the live release complete

- Verify CI on this PR's final head and the deployed app/runner source identity.
- In the signed-in candidate, search for several sites and inspect each real
  activity transition before the answer finishes. Check Stop and account switch.
- Run a connector read and verify its running row appears before the result.
- Run a prepared Work action and verify new journal events appear without pressing
  Refresh. Confirm approvals and takeover still pause execution.
- At phone and desktop widths, check Billing and checkout occupy the viewport,
  scroll internally, close correctly, and restore focus.
- Verify `--verify` passes on the actual configured portal. Check the existing
  account's plan-management preview and a new eligible account's Checkout form.
  Do not purchase a plan merely to test the UI; a completed charge requires a
  separately specified test purchase and spending authorization.
- Preserve the rollback revision and verify the existing webhook and entitlement
  acceptance gates. Do not label fixture tests as live payment acceptance.
