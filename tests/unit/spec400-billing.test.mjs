import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as usagePolicy from "../../src/lib/plan-usage-policy.mjs";
import { reactFixture, nodes, text } from "../helpers/kova-react-fixture.mjs";

// Load the actual immutable plan policy, not a second test-only pricing catalog.
const cache = new Map();
function policy(path) {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    if (name === "./plan-usage-policy.mjs") return usagePolicy;
    assert.ok(name.startsWith("@/lib/"));
    return policy(name.replace("@/", "src/") + (name.endsWith(".mjs") ? "" : ".ts"));
  });
  cache.set(path, exports);
  return exports;
}
const registry = policy("src/lib/capability-registry.ts");
const billing = policy("src/lib/billing-plans.ts");
const source = readFileSync("src/components/BillingWorkspace.tsx", "utf8");
const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const baseSummary = Object.freeze({
  tier: "plus",
  effectiveTier: "plus",
  inherited: false,
  activeSubscriptionCount: 1,
  billingConflict: false,
  status: "active",
  priceId: "plus_monthly",
  currentPeriodEnd: "2099-11-15T12:00:00Z",
  cancelAtPeriodEnd: false,
  trialing: false,
  hasBillingAccount: true,
  billingPortalAvailable: true,
});
function fixture(component, overrides = {}) {
  const calls = [];
  let exports;
  const props = {
    summary: { ...baseSummary },
    loading: false,
    error: null,
    loggedIn: true,
    portalLoading: false,
    inheritedSubscription: false,
    onManage: () => calls.push("portal"),
    onNavigate: () => calls.push("navigate"),
    onViewChange: () => calls.push("view"),
    children: "Overview content",
    ...overrides,
  };
  const f = reactFixture(
    "src/components/BillingWorkspace.tsx",
    (value) => {
      exports = value;
      return () => value[component](props);
    },
    {
      modules: {
        "@tanstack/react-router": { Link: "link" },
        "@/components/ui/tabs": {
          Tabs: "tabs",
          TabsList: "tablist",
          TabsTrigger: "tab",
          TabsContent: "panel",
        },
        "@/lib/capability-registry": registry,
        "@/lib/billing-plans": billing,
        "@/lib/introductory-offer": policy("src/lib/introductory-offer.ts"),
        "@/lib/time-format": policy("src/lib/time-format.ts"),
      },
    },
  );
  f.render();
  return { ...f, props, calls, exports };
}
const valueFor = (f, label) => {
  const row = f
    .nodes()
    .find(
      (node) =>
        node.type === "div" &&
        Array.isArray(node.props?.children) &&
        node.props.children.some((n) => n?.type === "dt" && text(n) === label),
    );
  return text(nodes(row).find((n) => n.type === "dd"));
};

test("Billing has accessible Overview, Plans, and Invoices tabs and changes only its view", async () => {
  const f = fixture("BillingWorkspace");
  assert.equal(f.find("tabs").props.value, "overview");
  assert.equal(f.find("tablist").props["aria-label"], "Billing sections");
  assert.deepEqual(
    f
      .nodes()
      .filter((n) => n.type === "tab")
      .map(text),
    ["Overview", "Plans", "Invoices"],
  );
  for (const view of ["plans", "invoices", "overview"]) {
    f.find("tabs").props.onValueChange(view);
    await f.flush();
    assert.equal(f.find("tabs").props.value, view);
    f.find("tabs").props.onValueChange(view);
  }
  assert.deepEqual(f.calls, ["view", "view", "view"]);
});

test("Overview renders verified status, configured interval, and service-supplied dates without inventing a charge", () => {
  const f = fixture("BillingSubscriptionFacts");
  assert.equal(valueFor(f, "Subscription status"), "Active");
  assert.equal(valueFor(f, "Billing interval"), "Monthly (configured plan)");
  assert.equal(
    valueFor(f, "Next billing date"),
    policy("src/lib/time-format.ts").formatDisplayDateTime(baseSummary.currentPeriodEnd, "system", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
  assert.equal(valueFor(f, "Next charge"), "Unavailable · check Stripe");
  assert.doesNotMatch(f.text(), /\$16|\$80/);
});

test("missing, invalid, stale and conflicting subscription fields never become fabricated dates or active status", () => {
  for (const [changes, status] of [
    [{ summary: null }, "Unavailable"],
    [{ loading: true }, "Checking…"],
    [{ error: "Unavailable" }, "Unavailable"],
    [{ summary: { ...baseSummary, billingConflict: true } }, "Unavailable"],
    [
      {
        summary: {
          ...baseSummary,
          status: "unrecognized",
          priceId: "unknown",
          currentPeriodEnd: "invalid",
        },
      },
      "Status unavailable",
    ],
  ]) {
    const f = fixture("BillingSubscriptionFacts", changes);
    assert.equal(valueFor(f, "Subscription status"), status);
    assert.doesNotMatch(f.text(), /Invalid Date|2099/);
  }
  const stale = fixture("BillingSubscriptionFacts", {
    summary: { ...baseSummary, currentPeriodEnd: "2020-01-01" },
  });
  assert.equal(valueFor(stale, "Next billing date"), "Unavailable");
});

test("pending cancellation shows only the supplied access-end date and offers no invented Resume action", () => {
  const f = fixture("BillingSubscriptionFacts", {
    summary: { ...baseSummary, cancelAtPeriodEnd: true },
  });
  assert.equal(
    valueFor(f, "Access end date"),
    policy("src/lib/time-format.ts").formatDisplayDateTime(baseSummary.currentPeriodEnd, "system", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
  assert.doesNotMatch(f.text(), /Next billing date|Resume subscription|Renews/);
  const missing = fixture("BillingSubscriptionFacts", {
    summary: { ...baseSummary, cancelAtPeriodEnd: true, currentPeriodEnd: null },
  });
  assert.match(missing.text(), /Cancellation is pending, but the access-end date is unavailable/);
});

test("payment failure directs to the existing portal without changing entitlement", async () => {
  for (const status of ["past_due", "unpaid", "incomplete"]) {
    const summary = Object.freeze({ ...baseSummary, status, effectiveTier: "free" });
    const f = fixture("BillingSubscriptionFacts", { summary });
    assert.equal(f.find("button").props.disabled, false);
    await f.click("Update payment method");
    assert.deepEqual(f.calls, ["portal"]);
    assert.equal(summary.effectiveTier, "free");
    assert.match(f.text(), /external Stripe billing portal/);
    const blocked = fixture("BillingSubscriptionFacts", {
      summary: { ...summary, billingPortalAvailable: false },
    });
    assert.equal(blocked.find("button").props.disabled, true);
    assert.match(blocked.text(), /Contact support@kovagpt.com/);
  }
});

test("family access never exposes another person's billing or management actions", () => {
  const overrides = {
    summary: { ...baseSummary, tier: "free", effectiveTier: "pro", activeSubscriptionCount: 0 },
    inheritedSubscription: true,
  };
  const facts = fixture("BillingSubscriptionFacts", overrides);
  assert.equal(valueFor(facts, "Subscription status"), "Family Sharing");
  assert.equal(valueFor(facts, "Next billing date"), "Managed by family owner");
  assert.doesNotMatch(facts.text(), /2099/);
  const plans = fixture("BillingPlans", overrides);
  assert.equal(plans.nodes().filter((n) => n.type === "button" && n.props.disabled).length, 3);
  assert.equal(fixture("BillingInvoices", overrides).find("button").props.disabled, true);
});

test("aligned Free Plus Pro cards share configured prices, feature order, allowances, and active-plan labels", () => {
  const f = fixture("BillingPlans");
  const cards = f.nodes().filter((n) => n.type === "article");
  assert.equal(cards.length, 3);
  const tiers = ["free", "plus", "pro"];
  cards.forEach((card, i) => {
    const plan = registry.CAPABILITY_REGISTRY.plans[tiers[i]];
    assert.equal(text(nodes(card).find((n) => n.type === "h4")), plan.name);
    assert.equal(text(nodes(card).find((n) => n.type === "strong")), `$${plan.monthlyPriceUsd}`);
    assert.deepEqual(
      nodes(card)
        .filter((n) => n.type === "dt")
        .map(text),
      ["Chat modes", "Messages", "Images", "Uploads", "Storage", "Adaptive Memory"],
    );
    for (const allowance of Object.values(registry.PLAN_ALLOWANCE_COPY[tiers[i]]))
      assert.ok(text(card).includes(allowance));
  });
  assert.equal(
    text(f.find("button", (n) => n.props["aria-label"] === "Plus: Current plan")),
    "Current plan",
  );
  assert.match(f.text(), /actual effective date, any proration/);
  assert.match(f.text(), /50% off the first paid month, once per account/);
  assert.match(f.text(), /\$8 for the first month, then \$16\/month/);
  assert.match(f.text(), /\$40 for the first month, then \$80\/month/);
  assert.match(f.text(), /If eligible: \$8 for the first month/);
  assert.match(f.text(), /Stripe Checkout confirms eligibility/);
  assert.match(f.text(), /New subscriptions do not receive a free trial/);
  assert.match(f.text(), /Existing trials and subscriptions keep their current terms/);
  assert.doesNotMatch(
    f.text(),
    /review proposal|Proposed first payment|Eligibility unverified|offer checkout remains unavailable|30-day trial for eligible|Get started|promo code|countdown/i,
  );
});

test("free upgrades reach existing pricing anchors, while paid changes require the existing portal", async () => {
  const freeSummary = {
    ...baseSummary,
    tier: "free",
    effectiveTier: "free",
    activeSubscriptionCount: 0,
    status: null,
    priceId: null,
    currentPeriodEnd: null,
    hasBillingAccount: false,
    billingPortalAvailable: false,
  };
  const free = fixture("BillingPlans", { summary: freeSummary });
  const links = free.nodes().filter((n) => n.type === "link");
  assert.deepEqual(
    links.map((n) => [n.props.to, n.props.hash]),
    [
      ["/pricing", "plus"],
      ["/pricing", "pro"],
    ],
  );
  links[0].props.onClick();
  assert.deepEqual(free.calls, ["navigate"]);
  const paid = fixture("BillingPlans");
  await paid.click("Upgrade: Pro");
  await paid.click("Change plan: Free");
  assert.deepEqual(paid.calls, ["portal", "portal"]);
  assert.equal(paid.nodes().filter((n) => n.type === "link").length, 0);
  const blocked = fixture("BillingPlans", {
    summary: { ...baseSummary, billingPortalAvailable: false },
  });
  assert.ok(
    blocked
      .nodes()
      .filter((n) => n.type === "button")
      .every((n) => n.props.disabled),
  );
  assert.equal(blocked.nodes().filter((n) => n.type === "link").length, 0);
  const pending = fixture("BillingPlans", { portalLoading: true });
  assert.equal(
    text(pending.find("button", (n) => n.props["aria-label"] === "Plus: Current plan")),
    "Current plan",
  );
  assert.ok(
    pending
      .nodes()
      .filter((n) => n.type === "button")
      .every((n) => n.props.disabled),
  );
});

test("unverified or conflicting accounts cannot select a new subscription", () => {
  for (const overrides of [
    { loading: true },
    { error: "failed" },
    { loggedIn: false },
    { summary: null },
    { summary: { ...baseSummary, billingConflict: true } },
  ]) {
    const f = fixture("BillingPlans", overrides);
    assert.ok(
      f
        .nodes()
        .filter((n) => n.type === "button")
        .every((n) => n.props.disabled),
    );
    assert.equal(f.nodes().filter((n) => n.type === "link").length, 0);
  }
});

test("Invoices declares its missing contract, offers actual portal navigation, and never fabricates a table or download", async () => {
  const f = fixture("BillingInvoices");
  assert.match(f.text(), /Invoice history is unavailable/);
  assert.match(f.text(), /invoice dates, amounts, payment statuses, or download links/);
  assert.equal(f.nodes().filter((n) => ["table", "a", "link"].includes(n.type)).length, 0);
  await f.click("View invoices in Stripe");
  assert.deepEqual(f.calls, ["portal"]);
  for (const overrides of [
    { loading: true },
    { error: "failed" },
    { loggedIn: false },
    { summary: null },
    { portalLoading: true },
    { summary: { ...baseSummary, hasBillingAccount: false } },
    { summary: { ...baseSummary, billingPortalAvailable: false } },
  ]) {
    assert.equal(fixture("BillingInvoices", overrides).find("button").props.disabled, true);
  }
  assert.match(fixture("BillingInvoices", { summary: null }).text(), /could not be verified/);
});

test("the Settings portal ignores success and errors after switching Billing sub-tabs", async () => {
  const body = settings.slice(
    settings.indexOf("  const handleManageBilling = async"),
    settings.indexOf("\n  useEffect", settings.indexOf("  const handleManageBilling = async")),
  );
  for (const fails of [false, true]) {
    const events = [];
    let settle;
    const pending = new Promise((resolve, reject) => {
      settle = fails ? reject : resolve;
    });
    const scope = { current: { epoch: 1, view: 0 } };
    const busy = { current: false };
    const deps = {
      open: true,
      loggedIn: true,
      portalLoading: false,
      portalPendingRef: busy,
      subSummary: baseSummary,
      billingScopeRef: scope,
      billingIsCurrent: () => true,
      createPortalSession: () => pending,
      setPortalLoading: (v) => events.push(["loading", v]),
      parseAllowedBillingPortalUrl: () => "https://billing.stripe.com/test",
      window: { location: { assign: () => events.push(["redirect"]) } },
      toast: { error: () => events.push(["error"]) },
    };
    const code = ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const run = new Function(...Object.keys(deps), `${code}; return handleManageBilling;`)(
      ...Object.values(deps),
    );
    const result = run();
    scope.current.view += 1;
    settle(fails ? new Error("unavailable") : { url: "https://billing.stripe.com/test" });
    await result;
    assert.deepEqual(events, [
      ["loading", true],
      ["loading", false],
    ]);
    assert.equal(busy.current, false);
  }
});

test("Billing is presentation-only and keeps existing policy and financial services authoritative", () => {
  assert.doesNotMatch(
    source,
    /fetch\(|authFetch|createCheckoutSession|\.subscriptions\.|\.invoices\.|localStorage|sessionStorage|generate.*pdf/i,
  );
  assert.match(settings, /parseAllowedBillingPortalUrl\(res.url\)/);
  assert.match(settings, /window.location.assign\(portalUrl\)/);
  assert.match(settings, /billingScopeRef.current.view \+= 1/);
  assert.match(readFileSync("src/routes/pricing.tsx", "utf8"), /id=\{name.toLowerCase\(\)\}/);
});

test("verified Free accounts without a subscription have no next charge, while failed reads remain unknown", () => {
  const summary = {
    ...baseSummary,
    tier: "free",
    effectiveTier: "free",
    activeSubscriptionCount: 0,
    status: null,
    priceId: null,
  };
  const free = fixture("BillingSubscriptionFacts", { summary });
  assert.equal(valueFor(free, "Next charge"), "Not applicable");
  assert.match(free.text(), /no active paid subscription/);
  for (const changes of [{ loading: true }, { error: "Failed" }, { loggedIn: false }]) {
    const failed = fixture("BillingSubscriptionFacts", { summary, ...changes });
    assert.notEqual(valueFor(failed, "Next charge"), "Not applicable");
  }
});

test("billing uses the shared semantic card and button radius tokens", () => {
  const css = readFileSync("src/styles/billing-surfaces.css", "utf8");
  assert.match(css, /\.kova-billing-plan-card \{[^}]*border-radius: var\(--kova-radius-card\);/s);
  assert.match(
    css,
    /\.kova-billing-plan-action \{[^}]*border-radius: var\(--kova-radius-button\);/s,
  );
  assert.doesNotMatch(css, /border-radius: (999px|10px)/);
});

test("billing renewal timestamps honor the same local 12/24-hour preference without altering the instant", () => {
  for (const timeFormat of ["system", "12-hour", "24-hour"]) {
    const f = fixture("BillingSubscriptionFacts", { timeFormat });
    assert.equal(
      valueFor(f, "Next billing date"),
      policy("src/lib/time-format.ts").formatDisplayDateTime(
        baseSummary.currentPeriodEnd,
        timeFormat,
        { dateStyle: "medium", timeStyle: "short" },
      ),
    );
    assert.equal(f.props.summary.currentPeriodEnd, baseSummary.currentPeriodEnd);
  }
});
