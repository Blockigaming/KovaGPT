import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const source = readFileSync(
  new URL("../../review-kit/components/BillingManagementPreview.tsx", import.meta.url),
  "utf8",
);
const pure = source.slice(
  source.indexOf("export type BillingPreviewTier"),
  source.indexOf("export function BillingManagementPreview("),
);
const code = transformSync(pure, { loader: "ts", format: "cjs", target: "es2022" }).code;
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const {
  createBillingPreviewState: create,
  billingPreviewReducer: reduce,
  SAMPLE_BILLING_INVOICES: invoices,
} = module.exports;

test("sample plan selection requires a review and confirmation before changing", () => {
  const initial = create("pro");
  assert.equal(reduce(initial, { type: "confirm" }), initial);
  assert.equal(reduce(initial, { type: "reviewPlan" }), initial);
  const selected = reduce(initial, { type: "selectPlan", tier: "plus" });
  assert.equal(selected.tier, "pro");
  const reviewing = reduce(selected, { type: "reviewPlan" });
  assert.equal(reviewing.stage, "plan_review");
  const canceled = reduce(reviewing, { type: "back" });
  assert.equal(canceled.tier, "pro");
  assert.equal(canceled.proposedTier, "pro");
  const confirmed = reduce(reviewing, { type: "confirm" });
  assert.equal(confirmed.tier, "plus");
  assert.match(confirmed.notice, /locally.*unresolved/);
});

test("sample cancellation and reactivation have guarded independent confirmations", () => {
  const initial = create("plus");
  assert.equal(reduce(initial, { type: "reviewReactivate" }), initial);
  const reviewing = reduce(initial, { type: "reviewCancel" });
  assert.equal(reviewing.cancellationScheduled, false);
  assert.equal(reduce(reviewing, { type: "back" }).cancellationScheduled, false);
  const scheduled = reduce(reviewing, { type: "confirm" });
  assert.equal(scheduled.cancellationScheduled, true);
  assert.equal(reduce(scheduled, { type: "reviewCancel" }), scheduled);
  const selected = reduce(scheduled, { type: "selectPlan", tier: "pro" });
  assert.equal(reduce(selected, { type: "reviewPlan" }), selected);
  const reactivation = reduce(scheduled, { type: "reviewReactivate" });
  assert.equal(reactivation.cancellationScheduled, true);
  assert.equal(reduce(reactivation, { type: "confirm" }).cancellationScheduled, false);
  assert.equal(reduce(create("free"), { type: "reviewCancel" }).stage, "overview");
});

test("invoice selection is limited to sample records and receipt navigation keeps selected identity", () => {
  const initial = create();
  assert.equal(reduce(initial, { type: "invoice", id: "real-invoice" }), initial);
  assert.equal(reduce(initial, { type: "document", document: "receipt" }), initial);
  const first = reduce(initial, { type: "invoice", id: invoices[0].id });
  const receipt = reduce(first, { type: "document", document: "receipt" });
  assert.equal(receipt.invoiceId, invoices[0].id);
  assert.equal(receipt.document, "receipt");
  const second = reduce(receipt, { type: "invoice", id: invoices[1].id });
  assert.equal(second.invoiceId, invoices[1].id);
  assert.equal(second.document, "invoice");
  assert.equal(reduce(second, { type: "closeInvoice" }).invoiceId, null);
});

test("reset removes draft transitions and document selection without persistence", () => {
  let state = reduce(create("plus"), { type: "reviewCancel" });
  state = reduce(state, { type: "confirm" });
  state = reduce(state, { type: "invoice", id: invoices[0].id });
  assert.deepEqual(reduce(state, { type: "reset", tier: "pro" }), create("pro"));
  assert.equal(reduce(state, { type: "selectPlan", tier: "enterprise" }), state);
});

test("preview uses canonical plan names and makes no financial or external requests", () => {
  assert.match(source, /CAPABILITY_REGISTRY.plans\[tier\].name/);
  assert.match(source, /owner decision required/i);
  assert.match(source, /not tax invoices or proof of payment/);
  assert.match(source, /No transaction, payment method or actual receipt/);
  assert.doesNotMatch(
    source,
    /fetch\(|authFetch|useServerFn|supabase|localStorage|sessionStorage|window\.open|https?:\/\//,
  );
  assert.doesNotMatch(source, /\$\d|\d+%|\d+-day/);
  assert.match(source, /open && <BillingSession/);
  assert.match(source, /restoreDialogFocus\(\s*returnFocusRef\?\.current/);
});
