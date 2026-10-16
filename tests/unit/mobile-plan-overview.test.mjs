import assert from "node:assert/strict";
import test from "node:test";
import * as entitlements from "../../src/lib/mode-entitlements.mjs";
import { loadUiModule, elements, text, createHookHarness } from "../helpers/ui-state-harness.mjs";
const modes = loadUiModule("src/lib/modes.ts", { "@/lib/mode-entitlements.mjs": entitlements });
const billing = loadUiModule("src/lib/billing-plans.ts", {});
const registry = loadUiModule("src/lib/capability-registry.ts", {
  "@/lib/modes": modes,
  "@/lib/billing-plans": billing,
});
test("mobile overview links canonical plans to complete focusable details without checkout", () => {
  const h = createHookHarness();
  let checkout = 0;
  const { Route } = loadUiModule("src/routes/pricing.tsx", {
    react: h.react,
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "lucide-react": Object.fromEntries(
      ["Check", "Sparkles", "Zap", "Crown", "Building2"].map((n) => [n, n]),
    ),
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ isLoaded: true, isSignedIn: false }),
      useClerkSafe: () => ({
        openSignIn: () => {
          throw Error("unexpected auth action");
        },
      }),
    },
    "@/hooks/useStripeCheckout": {
      useStripeCheckout: () => ({
        isOpen: false,
        openCheckout: () => checkout++,
        closeCheckout: () => {},
      }),
    },
    "@/components/EnterpriseContactDialog": { EnterpriseContactDialog: "EnterpriseContactDialog" },
    "@/components/public/PublicShell": { PublicShell: "PublicShell" },
    "@/components/public/PlanComparison": { PlanComparison: "PlanComparison" },
    "@/components/ui/dialog": Object.fromEntries(
      ["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map((n) => [
        n,
        n,
      ]),
    ),
    "@/lib/capability-registry": registry,
  });
  const tree = h.render(Route.component),
    nav = elements(tree, (n) => n.type === "nav" && n.props["aria-label"] === "Plan overview")[0];
  assert.ok(nav);
  const links = elements(nav, (n) => n.type === "a");
  assert.equal(links.length, 4);
  const cards = elements(tree, (n) => typeof n.type === "function" && n.type.name === "PlanCard");
  assert.equal(cards.length, 4);
  for (const tier of ["free", "plus", "pro"]) {
    const plan = registry.CAPABILITY_REGISTRY.plans[tier],
      link = links.find((n) => n.props.href === `#plan-${tier}`);
    assert.ok(text(link).includes(plan.name));
    assert.ok(text(link).includes(`$${plan.monthlyPriceUsd}`));
    assert.equal(link.props.onClick, undefined);
    const card = cards.find((n) => n.props.id === `plan-${tier}`);
    assert.equal(card.props.name, plan.name);
    assert.equal(card.props.price, `$${plan.monthlyPriceUsd}`);
    const article = card.type(card.props);
    assert.equal(article.props.id, `plan-${tier}`);
    assert.equal(article.props.tabIndex, -1);
    assert.ok(
      elements(article, (n) => n.type === "h2").some(
        (n) => n.props.id === article.props["aria-labelledby"],
      ),
    );
    for (const feature of plan.features) assert.ok(text(article).includes(feature));
  }
  assert.ok(text(links[3]).includes(registry.CAPABILITY_REGISTRY.enterprise.priceLabel));
  assert.equal(links[3].props.href, "#plan-enterprise");
  assert.equal(checkout, 0);
});
