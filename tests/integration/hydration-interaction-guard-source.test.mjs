import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the server shell keeps native controls disabled until hydration is complete", async () => {
  const source = await read("src/routes/__root.tsx");

  assert.match(source, /data-kova-hydration="pending"/);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /<fieldset\s+[\s\S]*?disabled=\{!hydrated\}/);
  assert.match(source, /data-kova-interaction-guard=\{hydrated \? "ready" : "pending"\}/);
  assert.match(source, /className="contents"/);
  assert.match(source, /document\.documentElement\.dataset\.kovaHydration = "ready"/);
  assert.match(source, /document\.documentElement\.removeAttribute\("aria-busy"\)/);
  assert.match(source, /window\.dispatchEvent\(new Event\(HYDRATION_READY_EVENT\)\)/);

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

test("the affected browser specs wait for readiness and assert principal-scoped archives", async () => {
  const paths = [
    "tests/e2e/ai-core-parity.spec.ts",
    "tests/e2e/core-chat-experience.spec.ts",
    "tests/e2e/desktop-polish.spec.ts",
    "tests/e2e/high-impact-chat.spec.ts",
  ];
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
  for (let index = 0; index < specs.length; index += 1) {
    const gotoCount = specs[index].match(/await page\.goto\(/g)?.length ?? 0;
    const waitCount = specs[index].match(/await waitForKovaHydration\(page\)/g)?.length ?? 0;
    assert.equal(waitCount, gotoCount, paths[index]);
  }

  const highImpact = specs.at(-1);
  assert.match(highImpact, /legacy: localStorage\.getItem\("kovagpt:archived"\)/);
  assert.match(highImpact, /guest: localStorage\.getItem\("kovagpt:archived:v2:guest"\)/);
  assert.match(highImpact, /toEqual\(\{ legacy: null, guest: "\[\]" \}\)/);
});
