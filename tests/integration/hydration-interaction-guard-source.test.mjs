import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the server shell reports hydration state without globally disabling controls", async () => {
  const source = await read("src/routes/__root.tsx");

  assert.match(source, /data-kova-hydration="pending"/);
  assert.match(source, /aria-busy="true"/);

  assert.doesNotMatch(source, /<fieldset\s+[\s\S]*?disabled=\{!hydrated\}/);

  assert.doesNotMatch(source, /data-kova-interaction-guard=\{hydrated \? "ready" : "pending"\}/);

  assert.match(source, /document\.documentElement\.dataset\.kovaHydration = "ready"/);

  assert.match(source, /document\.documentElement\.removeAttribute\("aria-busy"\)/);

  assert.match(source, /window\.dispatchEvent\(new Event\(HYDRATION_READY_EVENT\)\)/);

  assert.match(source, /return <>\{children\}<\/>;/);

  const bootstrapIndex = source.indexOf("<ScriptOnce>{EARLY_SHORTCUT_BOOTSTRAP}</ScriptOnce>");
  const guardIndex = source.indexOf("<HydrationInteractionGuard>{children}");
  const clientScriptsIndex = source.indexOf("<Scripts />", guardIndex);

  assert.ok(bootstrapIndex > -1 && bootstrapIndex < guardIndex);
  assert.ok(guardIndex < clientScriptsIndex);
});

test("the early bootstrap replays both global shortcuts after hydration", async () => {
  const source = await read("src/routes/__root.tsx");
  const match = source.match(/const EARLY_SHORTCUT_BOOTSTRAP = `([\s\S]*?)`;/);
  assert.ok(match?.[1], "expected the inline hydration bootstrap");
  const bootstrap = match[1].replace("${HYDRATION_READY_EVENT}", "kova:hydrated");
  const listeners = new Map();
  const addEventListener = (type, listener, options) => {
    const registered = listeners.get(type) ?? [];
    registered.push({ listener, once: Boolean(options?.once) });
    listeners.set(type, registered);
  };
  const removeEventListener = (type, listener) => {
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((registered) => registered.listener !== listener),
    );
  };
  const dispatchEvent = (event) => {
    for (const registered of [...(listeners.get(event.type) ?? [])]) {
      registered.listener(event);
      if (registered.once) removeEventListener(event.type, registered.listener);
    }
    return !event.defaultPrevented;
  };
  class KeyboardEvent {
    constructor(type, init) {
      Object.assign(this, init, { type, defaultPrevented: false });
    }

    preventDefault() {
      this.defaultPrevented = true;
    }
  }
  const window = { addEventListener, removeEventListener, dispatchEvent };
  vm.runInNewContext(bootstrap, { KeyboardEvent, window });

  let prevented = false;
  let stopped = false;
  dispatchEvent({
    type: "keydown",
    key: "k",
    code: "KeyK",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  let newChatPrevented = false;
  dispatchEvent({
    type: "keydown",
    key: "O",
    code: "KeyO",
    ctrlKey: false,
    metaKey: true,
    shiftKey: true,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() {
      newChatPrevented = true;
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {},
  });
  assert.equal(newChatPrevented, true);

  const replayed = [];
  addEventListener("keydown", (event) => replayed.push(event));
  dispatchEvent({ type: "kova:hydrated", defaultPrevented: false });
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].key, "k");
  assert.equal(replayed[0].ctrlKey, true);
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
    ["tests/e2e/high-impact-chat.spec.ts", 5, 5],
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
    ["tests/e2e/ui-quality.spec.ts", 6, 6],
  ];
  const paths = contracts.map(([path]) => path);
  const [helper, guardSpec, home, ...specs] = await Promise.all([
    read("tests/e2e/hydration.ts"),
    read("tests/e2e/hydration-interaction-guard.spec.ts"),
    read("src/routes/index.tsx"),
    ...paths.map(read),
  ]);

  assert.match(helper, /toHaveAttribute\(\s*"data-kova-hydration"\s*,\s*"ready"\s*,\s*\{/s);
  assert.match(helper, /timeout: 30_000/);
  assert.match(guardSpec, /resourceType\(\) === "script"/);
  assert.match(guardSpec, /"data-kova-hydration"\s*,\s*"pending"/s);
  assert.match(guardSpec, /toBeDisabled\(\)/);
  assert.match(guardSpec, /toBeEnabled\(\)/);
  assert.match(guardSpec, /toEqual\(\["k", "o"\]\)/);
  assert.equal((home.match(/disabled=\{!principalReady\}/g) ?? []).length, 2);
  const specsByPath = new Map();
  for (let index = 0; index < specs.length; index += 1) {
    const [path, expectedGotos, expectedWaits, expectedAdjacentWaits = expectedWaits] =
      contracts[index];
    const gotoCount = specs[index].match(/await page\.goto\(/g)?.length ?? 0;
    const waitCount = specs[index].match(/await waitForKovaHydration\(page\)/g)?.length ?? 0;
    const adjacentWaitCount =
      specs[index].match(/await page\.goto\([^;]+;\s*await waitForKovaHydration\(page\);/g)
        ?.length ?? 0;
    assert.match(specs[index], /from "\.\/hydration"/);
    assert.equal(gotoCount, expectedGotos, `${path} navigation count`);
    assert.equal(waitCount, expectedWaits, `${path} hydration wait count`);
    assert.equal(adjacentWaitCount, expectedAdjacentWaits, `${path} post-goto wait placement`);
    specsByPath.set(path, specs[index]);
  }

  const highImpact = specsByPath.get("tests/e2e/high-impact-chat.spec.ts");
  assert.match(highImpact, /legacy: localStorage\.getItem\("kovagpt:archived"\)/);
  assert.match(highImpact, /guest: localStorage\.getItem\("kovagpt:archived:v2:guest"\)/);
  assert.match(highImpact, /toEqual\(\{ legacy: null, guest: "\[\]" \}\)/);

  const uiQuality = specsByPath.get("tests/e2e/ui-quality.spec.ts");
  assert.match(uiQuality, /await page\.route\("\*\*\/api\/chat"/);
  assert.match(uiQuality, /await page\.getByRole\("button", \{ name: "Send" \}\)\.click\(\)/);
  assert.doesNotMatch(uiQuality, /await page\.goBack\(\)/);
});
