import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

test("overview gallery controls wrap, API motion pauses, and article links navigate", () => {
  const hooks = createHookHarness();
  const { ProductOverview } = loadUiModule("src/components/public/ProductOverview.tsx", {
    react: hooks.react,
    "./PricingPlans": { PricingPage: "PricingPage" },
    "./MarketingChrome": { MarketingHeader: "MarketingHeader", MarketingFooter: "MarketingFooter" },
    "lucide-react": Object.fromEntries(
      ["ArrowRight", "ArrowUpRight", "Code2", "ChevronDown"].map((name) => [name, name]),
    ),
  });
  let tree = hooks.render(ProductOverview);
  const get = (id) => elements(tree, (node) => node.props.id === id)[0];
  assert.equal(elements(tree, (node) => node.type === "main").length, 1);
  assert.match(text(get("kx-scene-count")), /1.*6/);
  get("kx-scene-prev").props.onClick();
  tree = hooks.render(ProductOverview);
  assert.match(text(get("kx-scene-count")), /6.*6/);
  get("kx-scene-next").props.onClick();
  tree = hooks.render(ProductOverview);
  assert.match(text(get("kx-scene-count")), /1.*6/);
  get("kx-pause").props.onClick();
  tree = hooks.render(ProductOverview);
  assert.equal(get("kx-pause").props["aria-pressed"], true);
  assert.match(text(get("kx-pause")), /Resume/);
  const links = elements(tree, (node) => node.type === "a").map((node) => node.props.href);
  for (const href of [
    "/news/argon",
    "/news/neon",
    "/news/interactive-workspace",
    "/news/developer-platform",
    "/developers/quickstart",
  ])
    assert.ok(links.includes(href), href);
  assert.equal(elements(tree, (node) => node.type === "dialog").length, 0);
});

test("comparison keeps each tier's mode and allowance data in the correct column", () => {
  const tiers = ["free", "plus", "pro"];
  const plans = Object.fromEntries(tiers.map((tier) => [tier, { name: tier }]));
  const modesByTier = Object.fromEntries(tiers.map((tier) => [tier, [{ label: `${tier}-mode` }]]));
  const { PlanComparison } = loadUiModule("src/components/public/PlanComparison.tsx", {
    "@/lib/plan-usage-policy.mjs": {
      PLAN_USAGE_FACTOR: { free: 0.2, plus: 1, pro: 20 },
    },
    "@/lib/capability-registry": {
      CAPABILITY_REGISTRY: { plans, modesByTier },
    },
  });
  const tree = PlanComparison();
  const rows = elements(tree, (node) => node.type === "tbody")[0].props.children.flat();
  assert.deepEqual(
    Array.from(rows, (row) =>
      elements(row, (node) => node.type === "td").map((cell) => text(cell).replace(/\s+/g, " ")),
    ),
    [
      ["free-mode", "plus-mode", "pro-mode"],
      ["Very limited", "5× Free", "100× Free (20× Plus)"],
      ["Limited", "Limited", "Unlimited with Argon Lite"],
      ["Argon Medium, limited", "All seven models, limited", "All advanced models, limited"],
      ["Limited", "Expanded", "Highest allowance"],
      ["Included", "Included", "Included"],
    ],
  );
  assert.equal(elements(tree, (node) => node.props.role === "region")[0].props.tabIndex, 0);
  assert.equal(elements(tree, (node) => node.type === "button").length, 0);
});
