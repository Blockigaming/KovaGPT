import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as selection from "../../src/lib/consumer-model-selection.mjs";
import { CONSUMER_EFFORTS } from "../../src/lib/consumer-effort-policy.mjs";
import { isModeAllowedForTier } from "../../src/lib/mode-entitlements.mjs";

function fixture(overrides = {}) {
  const config = {
    value: selection.DEFAULT_CONSUMER_MODEL,
    mode: "instant",
    tier: "free",
    disabled: false,
    isLoaded: true,
    isSignedIn: true,
    ...overrides,
  };
  const changes = [];
  const f = reactFixture(
    "src/components/ConsumerModelSelector.tsx",
    (module) => () =>
      module.ConsumerModelSelector({
        ...config,
        onChange(id) {
          changes.push(["model", id]);
          config.value = id;
        },
        onModeChange(mode) {
          changes.push(["effort", mode]);
          config.mode = mode;
        },
      }),
    {
      modules: {
        "@/lib/consumer-model-selection.mjs": selection,
        "@/lib/modes": {
          isModeAllowedForTier,
          modesForTier: (tier) =>
            CONSUMER_EFFORTS.filter((effort) => isModeAllowedForTier(tier, effort.id)),
        },
        "@/components/auth/ClerkSafe": { useUser: () => config },
        "@/components/ui/popover": {
          Popover: "popover",
          PopoverContent: "popover-content",
          PopoverTrigger: "popover-trigger",
        },
      },
    },
  );
  f.render();
  return { ...f, config, changes };
}

for (const [tier, max, last] of [
  ["plus", 4, "max"],
  ["pro", 5, "ultra"],
]) {
  test(`${tier} picker exposes its models and range without applying a choice on render`, () => {
    const f = fixture({ tier });
    assert.deepEqual(f.changes, []);
    assert.match(f.text(), /DefaultRecommended · Kova Argon 4\.6/);
    const slider = f.find("input", (node) => node.props.type === "range");
    assert.equal(slider.props.max, max);
    assert.equal(slider.props["aria-valuetext"], "Lite");
    slider.props.onChange({ currentTarget: { valueAsNumber: max } });
    assert.deepEqual(f.changes, [["effort", last]]);
    for (const model of selection.CONSUMER_MODELS) {
      f.render();
      const button = f.find(
        "button",
        (node) => node.props["data-testid"] === `consumer-model-${model.id}`,
      );
      assert.equal(button.props.disabled, !model.tiers.includes(tier));
      button.props.onClick();
      assert.equal(
        f.changes.some(([kind, id]) => kind === "model" && id === model.id),
        model.tiers.includes(tier),
      );
    }
    assert.equal(f.config.mode, last);
  });
}

test("Default applies the recommended model and Lite through the choice callbacks", async () => {
  const f = fixture({ tier: "pro", value: "kova-xenon-5", mode: "ultra" });
  await f.click("DefaultRecommended · Kova Argon 4.6");
  assert.deepEqual(f.changes, [
    ["model", selection.DEFAULT_CONSUMER_MODEL],
    ["effort", "instant"],
  ]);
  const checked = f.nodes().filter((node) => node.props?.["aria-pressed"] === true);
  assert.equal(checked.length, 1);
  assert.equal(f.find("input", (node) => node.props.type === "range").props.value, 0);
});

test("a downgrade clears disallowed effort and sign-out disables both controls", async () => {
  const f = fixture({ tier: "pro", value: "kova-xenon-5", mode: "ultra" });
  f.config.tier = "plus";
  await f.flush();
  assert.deepEqual(f.changes, [["effort", "instant"]]);
  assert.equal(f.config.value, "kova-xenon-5");
  f.config.isSignedIn = false;
  f.render();
  const slider = f.find("input", (node) => node.props.type === "range");
  assert.equal(slider.props.disabled, true);
  slider.props.onChange({ currentTarget: { valueAsNumber: 4 } });
  for (const node of f.nodes().filter((node) => node.type === "button")) {
    assert.equal(node.props.disabled, true);
    node.props.onClick?.();
  }
  assert.deepEqual(f.changes, [["effort", "instant"]]);
});

for (const model of selection.CONSUMER_MODELS) {
  test(`Free exposes no model control for saved ${model.id} selection`, () => {
    const f = fixture({ tier: "free", value: model.id });
    assert.equal(f.text(), "");
    assert.equal(f.nodes().length, 0);
    assert.deepEqual(f.changes, []);
  });
}
