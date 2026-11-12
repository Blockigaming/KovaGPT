import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as selection from "../../src/lib/consumer-model-selection.mjs";

function fixture(overrides = {}) {
  const config = {
    value: "kova-argon-4.6",
    tier: "free",
    disabled: false,
    isLoaded: true,
    isSignedIn: true,
    isDesktop: true,
    interaction: "pointer",
    ...overrides,
  };
  const changes = [];
  const f = reactFixture(
    "src/components/ConsumerModelSelector.tsx",
    (module) => () =>
      module.ConsumerModelSelector({ ...config, onChange: (id) => changes.push(id) }),
    {
      modules: {
        "@/lib/consumer-model-selection.mjs": selection,
        "@/hooks/use-mobile": { useLayout: () => config },
        "@/components/auth/ClerkSafe": { useUser: () => config },
        "@/components/MobileBottomSheet": { MobileBottomSheet: "sheet" },
        "@/components/ui/popover": {
          Popover: "popover",
          PopoverContent: "popover-content",
          PopoverTrigger: "popover-trigger",
        },
      },
      globals: { window: { requestAnimationFrame: (callback) => callback() } },
    },
  );
  f.render();
  return { ...f, config, changes };
}
for (const tier of ["plus", "pro"]) {
  test(`${tier} picker shows seven products but authorizes only its entitled choices`, () => {
    const f = fixture({ tier });
    assert.match(f.text(), /Kova Argon 4\.6/);
    for (const model of selection.CONSUMER_MODELS) {
      const button = f.find(
        "button",
        (node) => node.props["data-testid"] === `consumer-model-${model.id}`,
      );
      assert.equal(button.props.disabled, !model.tiers.includes(tier));
      button.props.onClick();
      assert.equal(f.changes.includes(model.id), model.tiers.includes(tier));
    }
  });
}
test("sign-out and a plan downgrade never auto-send or silently replace the selected product", () => {
  const f = fixture({ tier: "plus", value: "kova-xenon-5" });
  assert.equal(
    f.find("button", (n) => n.props["data-testid"] === "consumer-model-trigger").props[
      "aria-label"
    ],
    "Choose Kova model: Kova Xenon 5",
  );
  assert.deepEqual(f.changes, []);
  f.config.isSignedIn = false;
  f.render();
  for (const model of selection.CONSUMER_MODELS) {
    const button = f.find("button", (n) => n.props["data-testid"] === `consumer-model-${model.id}`);
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  assert.deepEqual(f.changes, []);
});

for (const model of selection.CONSUMER_MODELS) {
  test(`Free exposes no model control for saved ${model.id} selection`, () => {
    const f = fixture({ tier: "free", value: model.id });
    assert.equal(f.text(), "");
    assert.equal(
      f.nodes().filter((node) => node.type === "button" || node.type === "popover").length,
      0,
    );
    assert.deepEqual(f.changes, []);
  });
}
