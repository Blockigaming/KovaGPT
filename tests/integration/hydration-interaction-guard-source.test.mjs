import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("the server shell reports hydration state without globally disabling controls", async () => {
  const root = await read("src/routes/__root.tsx");
  const styles = await read("src/styles.css");

  assert.match(root, /data-kova-hydration="pending"/);
  assert.match(root, /aria-busy="true"/);
  assert.match(root, /document\.documentElement\.dataset\.kovaHydration\s*=\s*"ready"/);
  assert.match(root, /document\.documentElement\.removeAttribute\("aria-busy"\)/);
  assert.match(root, /window\.dispatchEvent\(new Event\(HYDRATION_READY_EVENT\)\)/);
  assert.doesNotMatch(root, /aria-disabled=\{!hydrated\}/);
  assert.doesNotMatch(root, /pointer-events-none/);
  assert.doesNotMatch(styles, /data-kova-hydration=['"]pending['"][^}]*pointer-events:\s*none/s);
});

test("the early bootstrap replays both global shortcuts after hydration", async () => {
  const root = await read("src/routes/__root.tsx");

  assert.match(root, /const EARLY_SHORTCUT_BOOTSTRAP/);
  assert.match(root, /const key = event\.key\.toLowerCase\(\)/);
  assert.match(root, /key !== "k"/);
  assert.match(root, /event\.shiftKey && key === "o"/);
  assert.match(root, /pendingShortcuts\.push\(\{/);
  assert.match(root, /new KeyboardEvent\("keydown"/);
  assert.match(root, /\.\.\.shortcut/);
  assert.match(root, /bubbles:\s*true/);
  assert.match(root, /window\.addEventListener\("keydown", captureShortcut, true\)/);
  assert.match(root, /window\.addEventListener\("\$\{HYDRATION_READY_EVENT\}", replayShortcuts/);

  const replayed = [];
  const fakeWindow = {
    dispatchEvent(event) {
      replayed.push(event);
    },
  };
  const NativeKeyboardEvent = globalThis.KeyboardEvent;
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    constructor(type, init = {}) {
      const { bubbles, cancelable, composed, ...properties } = init;
      super(type, { bubbles, cancelable, composed });
      Object.assign(this, properties);
    }
  };
  try {
    const replay = (shortcut) =>
      fakeWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          ...shortcut,
          bubbles: true,
          cancelable: true,
        }),
      );
    replay({ key: "K", metaKey: true, ctrlKey: false, shiftKey: false });
    replay({ key: "O", metaKey: true, ctrlKey: false, shiftKey: true });
  } finally {
    globalThis.KeyboardEvent = NativeKeyboardEvent;
  }

  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].key, "K");
  assert.equal(replayed[0].metaKey, true);
  assert.equal(replayed[0].bubbles, true);
  assert.equal(replayed[1].key, "O");
  assert.equal(replayed[1].metaKey, true);
  assert.equal(replayed[1].shiftKey, true);
});

test("hydrated UI specs wait after navigation and assert principal-scoped archives", async () => {
  const contracts = [
    ["tests/e2e/ai-core-parity.spec.ts", 2, 2],
    ["tests/e2e/connected-reliability.spec.ts", 2, 2],
    ["tests/e2e/connectors-tasks-settings.spec.ts", 3, 3],
    ["tests/e2e/core-chat-experience.spec.ts", 2, 2],
    ["tests/e2e/depth.spec.ts", 5, 5],
    ["tests/e2e/desktop-polish.spec.ts", 2, 2],
    ["tests/e2e/final-readiness.spec.ts", 2, 2],
    ["tests/e2e/functional-reliability.spec.ts", 1, 1],
    ["tests/e2e/high-impact-chat.spec.ts", 4, 4],
    ["tests/e2e/mobile-quality.spec.ts", 5, 5],
    ["tests/e2e/mobile-shell-ui-truth.spec.ts", 2, 2],
    ["tests/e2e/model-selector.spec.ts", 1, 1],
    ["tests/e2e/multimodal-canvas.spec.ts", 2, 2],
    ["tests/e2e/product-completeness.spec.ts", 4, 4],
    ["tests/e2e/production-audit.spec.ts", 2, 1],
    ["tests/e2e/projects-library-workspaces.spec.ts", 3, 3],
    ["tests/e2e/responsive.spec.ts", 2, 2],
    ["tests/e2e/secondary-screens.spec.ts", 3, 3],
    ["tests/e2e/seo-indexing.spec.ts", 3, 2],
    ["tests/e2e/ui-quality.spec.ts", 3, 3],
  ];
  const paths = contracts.map(([path]) => path);
  const [helper, guardSpec, ...specs] = await Promise.all([
    read("tests/e2e/hydration.ts"),
    read("tests/e2e/hydration-interaction-guard.spec.ts"),
    ...paths.map(read),
  ]);

  assert.match(helper, /toHaveAttribute\(\s*"data-kova-hydration"\s*,\s*"ready"\s*,\s*\{/s);
  assert.match(helper, /timeout: 30_000/);
  assert.match(guardSpec, /resourceType\(\) === "script"/);
  assert.match(guardSpec, /"data-kova-hydration"\s*,\s*"pending"/s);
  assert.match(guardSpec, /toBeDisabled\(\)/);
  assert.match(guardSpec, /toBeEnabled\(\)/);
  assert.match(guardSpec, /toEqual\(\["k", "o"\]\)/);
  const specsByPath = new Map();
  for (let index = 0; index < specs.length; index += 1) {
    const [path, expectedGotos, expectedWaits] = contracts[index];
    const gotoCount = specs[index].match(/await page\.goto\(/g)?.length ?? 0;
    const waitCount = specs[index].match(/await waitForKovaHydration\(page\)/g)?.length ?? 0;
    const adjacentWaitCount =
      specs[index].match(/await page\.goto\([^;]+;\s*await waitForKovaHydration\(page\);/g)
        ?.length ?? 0;
    assert.match(specs[index], /from "\.\/hydration"/);
    assert.equal(gotoCount, expectedGotos, `${path} navigation count`);
    assert.equal(waitCount, expectedWaits, `${path} hydration wait count`);
    assert.equal(adjacentWaitCount, expectedWaits, `${path} wait placement`);
    specsByPath.set(path, specs[index]);
  }

  const highImpact = specsByPath.get("tests/e2e/high-impact-chat.spec.ts");
  assert.match(highImpact, /legacy: localStorage\.getItem\("kovagpt:archived"\)/);
  assert.match(highImpact, /guest: localStorage\.getItem\("kovagpt:archived:v2:guest"\)/);
  assert.match(highImpact, /toEqual\(\{ legacy: null, guest: "\[\]" \}\)/);
});
