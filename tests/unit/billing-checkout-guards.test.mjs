import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

function loadPureFunction(source, name, scriptKind, dependencies = []) {
  const sourceFile = ts.createSourceFile(
    `source.${scriptKind === ts.ScriptKind.TSX ? "tsx" : "ts"}`,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const requested = [...dependencies, name];
  for (const functionName of requested) {
    assert.ok(declarations.has(functionName), `Expected ${functionName} to be declared`);
  }

  const functionSource = requested
    .map((functionName) =>
      declarations
        .get(functionName)
        .getText(sourceFile)
        .replace(/^export\s+/u, ""),
    )
    .join("\n");
  const compiled = ts.transpileModule(functionSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = Object.create(null);
  vm.runInNewContext(`${compiled}\nglobalThis.__functionUnderTest = ${name};`, context, {
    timeout: 1_000,
  });
  return context.__functionUnderTest;
}

test("checkout return accepts only plausible Stripe session IDs", async () => {
  const route = await read("src/routes/checkout.return.tsx");
  const normalize = loadPureFunction(route, "normalizeCheckoutSessionId", ts.ScriptKind.TSX);
  const liveId = `cs_live_${"A1".repeat(12)}`;
  const testId = `cs_test_${"b2".repeat(12)}`;

  assert.equal(normalize(liveId), liveId);
  assert.equal(normalize(`  ${testId}  `), testId);
  for (const value of [
    undefined,
    null,
    "",
    "fake",
    "session_live_1234567890123456",
    "cs_fake_1234567890123456",
    "cs_live_short",
    `cs_live_${"x".repeat(193)}`,
  ]) {
    assert.equal(normalize(value), undefined);
  }
});

test("checkout return reports active only from the server-verified account tier", async () => {
  const route = await read("src/routes/checkout.return.tsx");
  const resolveTier = loadPureFunction(route, "checkoutVerificationForTier", ts.ScriptKind.TSX);

  assert.equal(resolveTier("free").kind, "pending");
  assert.equal(resolveTier("plus").kind, "active");
  assert.equal(resolveTier("plus").tier, "plus");
  assert.equal(resolveTier("pro").kind, "active");
  assert.equal(resolveTier("pro").tier, "pro");

  assert.match(route, /session_id: normalizeCheckoutSessionId\(s\.session_id\)/u);
  assert.match(route, /getSubscriptionSummary\(\{ data: \{ environment: BILLING_ENV \} \}\)/u);
  assert.match(route, /setVerification\(checkoutVerificationForTier\(summary\.tier\)\)/u);
  assert.match(route, /Subscription verification pending/u);
  assert.match(route, /this page never grants access on its own/u);
  assert.doesNotMatch(
    route,
    /Subscription activated|Your subscription is active|Payment Successful/iu,
  );
});

test("every still-active subscription blocks a second Checkout session", async () => {
  const payments = await read("src/utils/payments.functions.ts");
  const blocksCheckout = loadPureFunction(
    payments,
    "hasStillActiveSubscription",
    ts.ScriptKind.TS,
    ["subscriptionWindowState"],
  );
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const future = "2026-10-03T12:00:00.000Z";
  const expired = "2026-08-03T12:00:00.000Z";

  for (const row of [
    { status: "active", current_period_end: future, cancel_at_period_end: true },
    { status: "active", current_period_end: null, cancel_at_period_end: true },
    { status: "trialing", current_period_end: future, cancel_at_period_end: true },
    { status: "past_due", current_period_end: future, cancel_at_period_end: true },
    { status: "canceled", current_period_end: future, cancel_at_period_end: true },
    { status: "active", current_period_end: "invalid-date", cancel_at_period_end: true },
  ]) {
    assert.equal(blocksCheckout([row], now), true, `${row.status} should block Checkout`);
  }

  assert.equal(blocksCheckout([], now), false);
  assert.equal(blocksCheckout([{ status: "active", current_period_end: expired }], now), false);
  assert.equal(blocksCheckout([{ status: "canceled", current_period_end: expired }], now), false);
  assert.equal(
    blocksCheckout([{ status: "incomplete_expired", current_period_end: future }], now),
    false,
  );
  assert.equal(
    blocksCheckout(
      [
        { status: "canceled", current_period_end: expired },
        { status: "active", current_period_end: future, cancel_at_period_end: true },
      ],
      now,
    ),
    true,
    "an expired newest row must not hide an older active subscription",
  );

  const checkout = payments.slice(
    payments.indexOf("export const createCheckoutSession"),
    payments.indexOf("export const createPortalSession"),
  );
  assert.match(checkout, /\.select\("status, current_period_end"\)/u);
  assert.match(checkout, /const stillActive = hasStillActiveSubscription\(subscriptions\)/u);
  assert.match(checkout, /if \(stillActive\)/u);
  assert.doesNotMatch(checkout, /!existing\.cancel_at_period_end/u);
  assert.doesNotMatch(checkout, /\.limit\(1\)\s*\.maybeSingle\(\)/u);
  assert.match(checkout, /subscriptions\.length === 0/u);
  assert.ok(
    checkout.indexOf("if (stillActive)") < checkout.indexOf("stripe.prices.list"),
    "the current-subscription guard must run before Stripe Checkout work",
  );
  assert.ok(
    checkout.indexOf("if (stillActive)") < checkout.indexOf("stripe.checkout.sessions.create"),
    "the current-subscription guard must run before Checkout session creation",
  );
});

test("subscription summary prefers an older active row over a newer expired row", async () => {
  const payments = await read("src/utils/payments.functions.ts");
  const selectSummaryRow = loadPureFunction(
    payments,
    "selectSubscriptionSummaryRow",
    ts.ScriptKind.TS,
    ["subscriptionWindowState", "hasVerifiedSubscriptionAccess"],
  );
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const expiredNewest = {
    status: "canceled",
    current_period_end: "2026-08-03T12:00:00.000Z",
    price_id: "plus_monthly",
  };
  const activeOlder = {
    status: "active",
    current_period_end: "2026-10-03T12:00:00.000Z",
    price_id: "pro_monthly",
  };
  assert.equal(selectSummaryRow([expiredNewest, activeOlder], now).price_id, "pro_monthly");
  assert.equal(selectSummaryRow([expiredNewest], now), expiredNewest);
  assert.equal(selectSummaryRow([], now), null);

  const hasVerifiedAccess = loadPureFunction(
    payments,
    "hasVerifiedSubscriptionAccess",
    ts.ScriptKind.TS,
    ["subscriptionWindowState"],
  );
  assert.equal(
    hasVerifiedAccess({ status: "active", current_period_end: "invalid-date" }, now),
    false,
    "ambiguous periods must block Checkout without granting paid access",
  );
  assert.equal(hasVerifiedAccess(activeOlder, now), true);

  const summary = payments.slice(payments.indexOf("export const getSubscriptionSummary"));
  assert.doesNotMatch(summary, /\.limit\(1\)\s*\.maybeSingle\(\)/u);
  assert.match(summary, /selectSubscriptionSummaryRow\(subscriptions, now\)/u);
  assert.match(summary, /hasVerifiedSubscriptionAccess\(row, now\)/u);
});
