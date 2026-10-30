import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const modes = [
  { id: "instant", label: "Instant" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "extra_high", label: "Extra high" },
  { id: "max", label: "Max" },
  { id: "ultra", label: "Ultra" },
];

function fixture(initial = {}) {
  const config = {
    mode: "high",
    userTier: "plus",
    placement: "composer",
    isDesktop: true,
    interaction: "pointer",
    isLoaded: true,
    isSignedIn: true,
    ...initial,
  };
  const changes = [];
  const frames = [];
  const focused = [];
  const f = reactFixture(
    "src/components/ResponsiveModelSelector.tsx",
    (module) => () =>
      module.ResponsiveModelSelector({
        mode: config.mode,
        userTier: config.userTier,
        placement: config.placement,
        onChange(mode) {
          changes.push(mode);
          config.mode = mode;
        },
      }),
    {
      modules: {
        "@/lib/modes": {
          MODES: modes,
          versionGroupsForTier: (tier) => [
            { id: "current", label: "Current", modes: modes.slice(0, tier === "pro" ? 6 : 3) },
          ],
        },
        "@/lib/mode-display-label": {
          modeDisplayLabel: (mode) =>
            mode.id === "high" && config.userTier === "plus" ? "Thinking" : mode.label,
        },
        "@/hooks/use-mobile": { useLayout: () => config },
        "@/components/auth/ClerkSafe": { useUser: () => config },
        "@/components/MobileBottomSheet": { MobileBottomSheet: "mobile-sheet" },
        "@/components/NovaLogo": { NovaLogo: "logo" },
        "@/components/ui/popover": {
          Popover: "popover",
          PopoverContent: "popover-content",
          PopoverTrigger: "popover-trigger",
        },
      },
      globals: {
        window: { requestAnimationFrame: (callback) => frames.push(callback) },
      },
    },
  );
  const trigger = () =>
    f.find("button", (node) => node.props["data-testid"] === "model-selector-trigger");
  return {
    ...f,
    config,
    changes,
    focused,
    trigger,
    open() {
      f.find("popover").props.onOpenChange(true);
    },
    focusTrigger() {
      trigger().props.ref.current = {
        focus: (options) => focused.push(options),
        closest: () => null,
      };
    },
    runFrames() {
      for (const callback of frames.splice(0)) callback();
    },
  };
}

for (const [placement, side] of [
  ["composer", "top"],
  ["topbar", "bottom"],
]) {
  test(`${placement}: desktop choices use the portalled, collision-aware shared popover`, async () => {
    const f = fixture({ placement });
    await f.flush();
    f.open();
    await f.flush();
    const content = f.find("popover-content");
    assert.equal(content.props.role, "dialog");
    assert.equal(content.props["aria-label"], "Choose model");
    assert.equal(content.props.side, side);
    assert.equal(content.props.align, "start");
    assert.equal(content.props.collisionPadding, 12);
    assert.equal(content.props.id, f.trigger().props["aria-controls"]);
    assert.doesNotMatch(content.props.className, /absolute|bottom-full|top-full/);
    assert.equal(f.nodes().filter((node) => node.type === "mobile-sheet").length, 0);
  });
}

test("desktop opening focuses the selected option and leaves the native fallback intact", async () => {
  const f = fixture();
  await f.flush();
  const content = f.find("popover-content");
  const focusCalls = [];
  content.props.ref.current = {
    querySelector(selector) {
      assert.equal(selector, '[aria-pressed="true"]');
      return { focus: (options) => focusCalls.push(options) };
    },
  };
  let prevented = false;
  content.props.onOpenAutoFocus({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(
    focusCalls.map((options) => options.preventScroll),
    [true],
  );
  content.props.ref.current = { querySelector: () => null };
  prevented = false;
  content.props.onOpenAutoFocus({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
});

test("choosing a paid option preserves its route ID, closes the picker and restores trigger focus", async () => {
  const f = fixture();
  await f.flush();
  f.focusTrigger();
  f.open();
  await f.flush();
  f.find("button", (node) => node.props["data-testid"] === "model-option-medium").props.onClick();
  await f.flush();
  f.runFrames();
  assert.deepEqual(f.changes, ["medium"]);
  assert.equal(f.find("popover").props.open, false);
  assert.equal(f.trigger().props["aria-label"], "Choose model: KovaGPT Medium");
  assert.deepEqual(
    f.focused.map((options) => options.preventScroll),
    [true],
  );
});

test("touch layout retains the same trigger reference and the existing modal-sheet flow", async () => {
  const f = fixture();
  await f.flush();
  const triggerRef = f.trigger().props.ref;
  f.config.isDesktop = false;
  f.config.interaction = "touch";
  await f.flush();
  assert.equal(f.trigger().props.ref, triggerRef);
  f.focusTrigger();
  let prevented = false;
  f.trigger().props.onClick({
    preventDefault: () => {
      prevented = true;
    },
  });
  await f.flush();
  assert.equal(prevented, true, "A touch click opens only the modal sheet");
  assert.equal(f.find("mobile-sheet").props.open, true);
  assert.equal(f.nodes().filter((node) => node.type === "popover-content").length, 0);
  f.find("mobile-sheet").props.onOpenChange(false);
  await f.flush();
  f.runFrames();
  assert.equal(f.find("mobile-sheet").props.open, false);
  assert.deepEqual(
    f.focused.map((options) => options.preventScroll),
    [true],
  );
});

for (const identity of [
  { isLoaded: true, isSignedIn: false },
  { isLoaded: true, userTier: "free" },
  { isLoaded: false },
]) {
  test(`locked identity never mounts a switchable picker: ${JSON.stringify(identity)}`, async () => {
    const f = fixture(identity);
    await f.flush();
    assert.equal(f.nodes().filter((node) => node.type === "popover").length, 0);
    assert.equal(
      f.nodes().filter((node) => node.props?.["data-testid"] === "model-selector-trigger").length,
      0,
    );
    if (identity.isLoaded) assert.deepEqual(f.changes, ["instant"]);
    else assert.deepEqual(f.changes, []);
  });
}
