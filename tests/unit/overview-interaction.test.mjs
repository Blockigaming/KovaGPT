import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

test("overview example selection updates the response and exposes a single selected option", () => {
  const hooks = createHookHarness();
  const { ProductOverview } = loadUiModule("src/components/public/ProductOverview.tsx", {
    react: hooks.react,
    "lucide-react": Object.fromEntries(
      [
        "ArrowRight",
        "ArrowUp",
        "BookOpen",
        "Check",
        "FileText",
        "Folder",
        "ListChecks",
        "MessageSquare",
        "PenLine",
        "Plus",
        "Search",
        "ShieldCheck",
      ].map((name) => [name, name]),
    ),
    "@/components/public/PublicShell": { PublicShell: "PublicShell" },
    "@/components/public/PublicSections": {
      PublicAction: "PublicAction",
      PublicHero: "PublicHero",
      PublicSection: "PublicSection",
    },
    "@/components/public/PublicFaq": { PublicFaq: "PublicFaq" },
  });
  let tree = hooks.render(ProductOverview);
  const options = () => elements(tree, (node) => node.type === "button");
  assert.equal(options().filter((node) => node.props["aria-pressed"]).length, 1);
  assert.match(text(tree), /Illustrative conversation/);
  assert.match(text(tree), /Find the thread in your ideas/);
  options()
    .find((node) => text(node) === "Learn")
    .props.onClick();
  tree = hooks.render(ProductOverview);
  assert.match(text(tree), /Make room for the next question/);
  assert.doesNotMatch(text(tree), /Find the thread in your ideas/);
  assert.equal(text(options().find((node) => node.props["aria-pressed"])), "Learn");
  options()
    .find((node) => text(node) === "Plan")
    .props.onClick();
  tree = hooks.render(ProductOverview);
  assert.match(text(tree), /Give the work a place to start/);
  assert.equal(elements(tree, (node) => node.type === "main").length, 1);
  assert.equal(options().filter((node) => node.props["aria-pressed"]).length, 1);
});

test("comparison keeps each tier's mode and allowance data in the correct column", () => {
  const tiers = ["free", "plus", "pro"];
  const plans = Object.fromEntries(tiers.map((tier) => [tier, { name: tier }]));
  const modesByTier = Object.fromEntries(tiers.map((tier) => [tier, [{ label: `${tier}-mode` }]]));
  const allowances = Object.fromEntries(
    tiers.map((tier) => [
      tier,
      Object.fromEntries(
        ["chat", "image", "upload", "storage"].map((key) => [key, `${tier}-${key}`]),
      ),
    ]),
  );
  const { PlanComparison } = loadUiModule("src/components/public/PlanComparison.tsx", {
    "@/lib/capability-registry": {
      CAPABILITY_REGISTRY: { plans, modesByTier },
      PLAN_ALLOWANCE_COPY: allowances,
    },
  });
  const tree = PlanComparison();
  const rows = elements(tree, (node) => node.type === "tbody")[0].props.children.flat();
  for (const [index, key] of ["mode", "chat", "image", "upload", "storage"].entries()) {
    assert.deepEqual(
      elements(rows[index], (node) => node.type === "td").map(text),
      tiers.map((tier) => `${tier}-${key}`),
    );
  }
  assert.equal(elements(tree, (node) => node.props.role === "region")[0].props.tabIndex, 0);
  assert.equal(elements(tree, (node) => node.type === "button").length, 0);
});
