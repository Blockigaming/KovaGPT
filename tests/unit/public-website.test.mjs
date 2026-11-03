import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_WEBSITE_PAGES,
  PUBLIC_WEBSITE_PAGE_BY_PATH,
  PUBLIC_WEBSITE_FOOTER,
} from "../../src/lib/public-website-catalog.mjs";
import { isPublicIndexableRoute, robotsDirectiveForRoute } from "../../src/lib/seo-policy.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
} from "../helpers/ui-state-harness.mjs";

test("public information has distinct content, valid paths, honest status, and controlled indexing", () => {
  assert.ok(PUBLIC_WEBSITE_PAGES.length >= 100);
  assert.equal(PUBLIC_WEBSITE_PAGE_BY_PATH.size, PUBLIC_WEBSITE_PAGES.length);
  const bodies = new Set();
  for (const page of PUBLIC_WEBSITE_PAGES) {
    assert.match(page.path, /^\/[a-z0-9/-]+$/u);
    assert.ok(page.title.length > 3);
    assert.ok(page.description.length > 20);
    assert.ok(page.sections.length >= 2 || page.related.length > 10);
    const body = page.sections.map((section) => section.body).join(" ");
    assert.ok(body.length >= 140 || page.related.length > 10, page.path);
    assert.ok(!bodies.has(body), page.path);
    bodies.add(body);
    assert.equal(isPublicIndexableRoute(page.path), page.indexable, page.path);
    if (!page.indexable) assert.equal(robotsDirectiveForRoute(page.path), "noindex, follow");
    if (page.path.startsWith("/connections/"))
      assert.ok(
        ["Requires configuration", "Restricted", "Coming soon"].includes(page.availability),
      );
    for (const related of page.related) assert.match(related.to, /^\/(?!\/)/u);
  }
  assert.ok(PUBLIC_WEBSITE_FOOTER.length >= 6);
  assert.ok(PUBLIC_WEBSITE_FOOTER.flatMap((group) => group.links).length >= 50);
});

function planFixture(summaryRead, signedIn = true) {
  const hooks = createHookHarness();
  let principal = signedIn ? "account-one" : null;
  const checkouts = [],
    redirects = [];
  const plans = Object.fromEntries(
    ["free", "plus", "pro"].map((tier) => [
      tier,
      {
        name: tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro",
        monthlyPriceUsd: tier === "free" ? 0 : tier === "plus" ? 16 : 80,
        lookupKey: tier === "free" ? null : `${tier}_monthly`,
        features: ["Published allowance"],
      },
    ]),
  );
  const { PublicPlans } = loadUiModule(
    "src/components/public/PublicPlans.tsx",
    {
      react: hooks.react,
      "@tanstack/react-router": { Link: "Link" },
      "lucide-react": { Check: "Check" },
      "@tanstack/react-start": { useServerFn: () => summaryRead },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({
          isLoaded: true,
          isSignedIn: Boolean(principal),
          user: principal ? { id: principal } : null,
        }),
      },
      "@/hooks/useStripeCheckout": {
        useStripeCheckout: () => ({
          openCheckout: (value) => checkouts.push(value),
          closeCheckout() {},
          isOpen: false,
          checkoutElement: null,
        }),
      },
      "@/lib/capability-registry": { CAPABILITY_REGISTRY: { plans } },
      "@/utils/payments.functions": { getSubscriptionSummary: "summary" },
      "@/components/ui/dialog": {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogDescription: "DialogDescription",
        DialogTitle: "DialogTitle",
      },
      "@/components/EnterpriseContactDialog": {
        EnterpriseContactDialog: "EnterpriseContactDialog",
      },
    },
    { window: { location: { assign: (url) => redirects.push(url) } } },
  );
  const render = () => hooks.render(PublicPlans);
  const click = () =>
    elements(
      render(),
      (node) => node.type === "button" && node.props.children === "Get Kova Plus",
    )[0].props.onClick();
  render();
  return {
    hooks,
    render,
    click,
    checkouts,
    redirects,
    changeAccount: (value) => {
      principal = value;
      render();
    },
  };
}

test("a logged-out plan selection preserves the intended plan through login", () => {
  let reads = 0;
  const f = planFixture(() => {
    reads++;
  }, false);
  f.click();
  assert.equal(reads, 0);
  assert.equal(f.checkouts.length, 0);
  assert.equal(f.redirects[0], "/login?return_to=%2Fpricing%3Fplan%3Dplus_monthly");
});

test("existing or inherited paid access goes to management without another checkout", async () => {
  for (const billing of [
    { activeSubscriptionCount: 1, effectiveTier: "free" },
    { activeSubscriptionCount: 0, effectiveTier: "pro" },
    { billingConflict: true, activeSubscriptionCount: 0, effectiveTier: "free" },
  ]) {
    const f = planFixture(async () => billing);
    f.click();
    await settle();
    assert.equal(f.checkouts.length, 0);
    assert.deepEqual(f.redirects, ["/settings/billing"]);
  }
});

test("only a verified Free summary opens the allowlisted monthly checkout", async () => {
  const f = planFixture(async () => ({
    billingConflict: false,
    activeSubscriptionCount: 0,
    effectiveTier: "free",
  }));
  f.click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.checkouts)), [
    { priceId: "plus_monthly", userId: "account-one" },
  ]);
});

test("an account change or unmount invalidates pending plan verification", async () => {
  for (const end of ["switch", "switch-back", "unmount"]) {
    const operation = deferred();
    const f = planFixture(() => operation.promise);
    f.click();
    if (end === "switch") f.changeAccount("account-two");
    else if (end === "switch-back") {
      f.changeAccount("account-two");
      f.changeAccount("account-one");
    } else f.hooks.unmount();
    operation.resolve({
      billingConflict: false,
      activeSubscriptionCount: 0,
      effectiveTier: "free",
    });
    await settle();
    assert.equal(f.checkouts.length, 0);
    assert.equal(f.redirects.length, 0);
  }
});

test("an unavailable summary fails closed and can be retried", async () => {
  const f = planFixture(async () => {
    throw new Error("network unavailable");
  });
  f.click();
  await settle();
  assert.equal(f.checkouts.length, 0);
  assert.equal(elements(f.render(), (node) => node.props.role === "alert").length, 1);
  f.click();
  await settle();
  assert.equal(f.checkouts.length, 0);
});
