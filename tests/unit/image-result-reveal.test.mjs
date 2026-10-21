import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/images.tsx", "utf8");
const file = ts.createSourceFile(
  "images.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const code = {};
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ["captureResultReveal", "generate"].includes(node.name?.text)
  )
    code[node.name.text] = node.getText(file);
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "clearResultReveal")
    code.clear = node.initializer.arguments[0].getText(file);
  if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect") {
    const callback = node.arguments[0].getText(file);
    if (callback.includes("const intent = resultRevealRef.current")) code.commit = callback;
    if (callback.includes("const pendingIntent = resultRevealRef.current")) code.pending = callback;
    if (callback.includes('router.subscribe("onBeforeNavigate", clearResultReveal)'))
      code.navigation = callback;
  }
  ts.forEachChild(node, visit);
}
visit(file);
for (const key of ["captureResultReveal", "generate", "clear", "commit", "pending", "navigation"])
  assert.ok(code[key], `Production ${key} is exercised`);
function compile(body, dependencies) {
  return new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(dependencies));
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(name, listener, capture = false) {
      const entries = listeners.get(name) ?? [];
      entries.push({ listener, capture });
      listeners.set(name, entries);
    },
    removeEventListener(name, listener, capture = false) {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter(
          (entry) => entry.listener !== listener || entry.capture !== capture,
        ),
      );
    },
    dispatch(name, target) {
      for (const { listener } of [...(listeners.get(name) ?? [])]) listener({ type: name, target });
    },
    count: () => [...listeners.values()].flat().length,
  };
}
function fixture({ signedIn = true } = {}) {
  const state = {
    loading: false,
    result: null,
    prompt: "",
    error: null,
    modal: null,
    limitOpen: false,
    loginOpen: false,
    settingsOpen: false,
    lightbox: null,
  };
  const actions = [],
    requests = [],
    calls = [];
  const origin = { name: "Generate" };
  const document = {
    ...events(),
    activeElement: origin,
    body: {},
    documentElement: {},
    hidden: false,
    querySelector: () => state.modal,
  };
  const window = { ...events(), location: { href: "https://kova.test/images" } };
  const router = {
    state: { status: "idle", location: { pathname: "/images" } },
    subscribe(name, listener) {
      assert.equal(name, "onBeforeNavigate");
      this.navigate = listener;
      return () => {
        this.navigate = null;
      };
    },
  };
  const heading = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    focus(options) {
      calls.push(["focus", options]);
      document.activeElement = this;
    },
    scrollIntoView(options) {
      calls.push(["scroll", options]);
    },
  };
  const promptInput = {
    ...heading,
    focus(options) {
      calls.push(["prompt-focus", options]);
      document.activeElement = this;
    },
    scrollIntoView(options) {
      calls.push(["prompt-scroll", options]);
    },
  };
  const generationStatus = {
    ...heading,
    focus(options) {
      calls.push(["pending-focus", options]);
      document.activeElement = this;
      document.dispatch("focusin", this);
    },
    scrollIntoView(options) {
      calls.push(["pending-scroll", options]);
    },
  };
  const dependencies = {
    document,
    window,
    router,
    userKey: signedIn ? "owner" : null,
    isSignedIn: signedIn,
    resultRevealRef: { current: null },
    resultHeadingRef: { current: heading },
    generationStatusRef: { current: generationStatus },
    inputRef: { current: promptInput },
    resultOwnerRef: { current: signedIn ? "owner" : null },
    generationRef: { current: 0 },
    submittingRef: { current: false },
    generationControllerRef: { current: null },
    aspectRatio: "1:1",
    editSelection: null,
    IMAGE_GENERATION_UNAVAILABLE: "Temporarily unavailable; prompt is kept",
    setPrompt(value) {
      state.prompt = typeof value === "function" ? value(state.prompt) : value;
    },
    setLoading: (value) => {
      state.loading = value;
    },
    setResult: (value) => {
      state.result = value;
    },
    setResultPrompt: (value) => {
      state.resultPrompt = value;
    },
    setError: (value) => {
      state.error = value;
    },
    setLoginOpen: (value) => actions.push(["login", value]),
    setLimitOpen: (value) => {
      state.limitOpen = value;
      actions.push(["limit", value]);
    },
    setLimitMessage: (value) => actions.push(["limit-message", value]),
    addToHistory: (...args) => actions.push(["history", ...args]),
    safeImageUrl: (value) => (value?.startsWith("data:image/") ? value : null),
    imageApiRequest: (...args) =>
      new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
  };
  dependencies.clearResultReveal = compile(`return (${code.clear});`, dependencies);
  dependencies.captureResultReveal = compile(
    `${code.captureResultReveal}; return captureResultReveal;`,
    dependencies,
  );
  const generate = compile(`${code.generate}; return generate;`, dependencies);
  const unmount = compile(`return (${code.navigation})();`, dependencies);
  return {
    state,
    actions,
    requests,
    calls,
    origin,
    document,
    window,
    router,
    heading,
    generationStatus,
    promptInput,
    dependencies,
    generate,
    unmount,
    commit: () => compile(`return (${code.commit})();`, { ...dependencies, ...state }),
    pendingCommit: () => compile(`return (${code.pending})();`, { ...dependencies, ...state }),
    finish(index = requests.length - 1, status = 200, imageUrl = "data:image/png;base64,local") {
      requests[index].resolve({
        response: { ok: status === 200, status },
        body:
          status === 200
            ? { imageUrl }
            : { error: status === 429 ? "Daily limit reached" : "Unavailable" },
      });
    },
  };
}

// Runtime tests execute production handlers and effects with inert local responses.
// They do not run a browser, call a provider, or invoke save/download actions.
test("current successful generation reveals its stable result heading once after commit", async () => {
  const f = fixture();
  const pending = f.generate("A paper bird");
  f.commit();
  assert.deepEqual(f.calls, []);
  f.document.activeElement = f.document.body; // Disabled submit loses focus in browsers.
  f.finish();
  await pending;
  assert.equal(f.state.prompt, "");
  assert.equal(f.calls.length, 0, "Focus waits for the completed result DOM");
  f.commit();
  assert.deepEqual(f.calls, [
    ["focus", { preventScroll: true }],
    ["scroll", { block: "start", behavior: "instant" }],
  ]);
  assert.equal(f.document.activeElement, f.heading);
  assert.equal(f.dependencies.resultRevealRef.current, null);
  assert.equal(f.document.count() + f.window.count(), 0);
  f.commit();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.actions.map(([name]) => name),
    ["history"],
  );
  assert.match(
    source,
    /<h2\s+id="image-result-title"\s+ref=\{resultHeadingRef\}\s+tabIndex=\{-1\}/,
  );
  assert.match(source, /aria-labelledby="image-result-title"/);
});

test("every newer interaction cancels reveal both during the request and before commit", async () => {
  for (const event of ["pointerdown", "keydown", "input", "wheel", "touchmove", "focusin"])
    for (const afterResponse of [false, true]) {
      const f = fixture();
      const pending = f.generate("First prompt");
      if (afterResponse) {
        f.finish();
        await pending;
      }
      f.document.dispatch(event, { name: "New work" });
      f.document.activeElement = f.document.body;
      f.state.prompt = "My next prompt";
      if (!afterResponse) {
        f.finish();
        await pending;
      }
      f.commit();
      assert.deepEqual(f.calls, [], `${event}, after response: ${afterResponse}`);
      assert.equal(f.state.prompt, "My next prompt");
      assert.equal(f.dependencies.resultRevealRef.current, null);
      assert.equal(f.document.count() + f.window.count(), 0);
    }
});

test("navigation, hidden tabs, window departure and unmount abandon pending reveal", async () => {
  const departures = [
    (f) => f.router.navigate(),
    ...["popstate", "hashchange", "pagehide", "blur"].map(
      (event) => (f) => f.window.dispatch(event),
    ),
    (f) => {
      f.document.hidden = true;
      f.document.dispatch("visibilitychange");
      f.document.hidden = false;
    },
    (f) => f.unmount(),
  ];
  for (const depart of departures) {
    const f = fixture();
    const pending = f.generate("Bird");
    depart(f);
    f.finish();
    await pending;
    f.commit();
    assert.deepEqual(f.calls, []);
    assert.equal(f.document.count() + f.window.count(), 0);
  }
});

test("commit rechecks owner, generation, URL, router state, focus and target visibility", async () => {
  for (const invalidate of [
    (f) => {
      f.dependencies.resultOwnerRef.current = "new-owner";
    },
    (f) => {
      f.dependencies.resultOwnerRef.current = null;
    },
    (f) => {
      f.dependencies.generationRef.current++;
    },
    (f) => {
      f.state.result = "data:image/png;base64,another";
    },
    (f) => {
      f.window.location.href += "?new";
    },
    (f) => {
      f.router.state.status = "pending";
    },
    (f) => {
      f.router.state.location.pathname = "/library";
    },
    (f) => {
      f.document.hidden = true;
    },
    (f) => {
      f.document.activeElement = {};
    },
    (f) => {
      f.heading.isConnected = false;
    },
    (f) => {
      f.heading.getClientRects = () => [];
    },
    (f) => {
      f.heading.closest = () => ({});
    },
    (f) => {
      f.state.modal = {};
    },
  ]) {
    const f = fixture();
    const pending = f.generate("Bird");
    f.finish();
    await pending;
    invalidate(f);
    f.commit();
    assert.deepEqual(f.calls, []);
    assert.equal(f.dependencies.resultRevealRef.current, null);
    assert.equal(f.document.count() + f.window.count(), 0);
  }
});

test("failed and invalid results restore the preserved prompt; quota dialogs retain focus", async () => {
  for (const [status, url] of [[503], [429], [200, "https://invalid.test/not-an-image"]]) {
    const f = fixture();
    const pending = f.generate("Keep this prompt");
    f.document.activeElement = f.document.body;
    f.finish(0, status, url);
    await pending;
    assert.deepEqual(f.calls, [], "Wait for the settled UI before restoring focus");
    f.commit();
    assert.equal(f.state.prompt, "Keep this prompt");
    assert.equal(f.state.loading, false);
    assert.ok(f.state.error);
    assert.equal(f.state.result, null);
    assert.deepEqual(
      f.calls,
      status === 429
        ? []
        : [
            ["prompt-focus", { preventScroll: true }],
            ["prompt-scroll", { block: "nearest", behavior: "instant" }],
          ],
    );
    if (status !== 429) assert.equal(f.document.activeElement, f.promptInput);
    const calls = f.calls.length;
    f.commit();
    assert.equal(f.calls.length, calls, "Failure restoration is one-shot");
    assert.equal(f.dependencies.resultRevealRef.current, null);
    assert.equal(f.document.count() + f.window.count(), 0);
    if (status === 429) assert.ok(f.actions.some(([name]) => name === "limit"));
  }
});

test("stale or aborted requests cannot mark a newer intent as completed", async () => {
  for (const abort of [false, true]) {
    const f = fixture();
    const pending = f.generate("Old prompt");
    if (abort) f.dependencies.generationControllerRef.current.abort();
    f.dependencies.generationRef.current++;
    f.dependencies.captureResultReveal(f.dependencies.generationRef.current, null);
    f.finish();
    await pending;
    assert.equal(f.dependencies.resultRevealRef.current.imageUrl, null);
    assert.equal(f.state.result, null);
    f.commit();
    assert.deepEqual(f.calls, []);
    f.unmount();
  }
});

test("duplicate and signed-out submissions do not create extra request or focus intents", async () => {
  const f = fixture();
  const pending = f.generate("Bird");
  const intent = f.dependencies.resultRevealRef.current;
  await f.generate("Again");
  assert.equal(f.dependencies.resultRevealRef.current, intent);
  assert.equal(f.requests.length, 1);
  f.finish();
  await pending;
  f.commit();
  const guest = fixture({ signedIn: false });
  await guest.generate("Bird");
  await guest.generate(" ");
  assert.equal(guest.requests.length, 0);
  assert.equal(guest.dependencies.resultRevealRef.current, null);
  assert.deepEqual(guest.actions, [["login", true]]);
});

test("regeneration with the same returned URL still gets a fresh one-shot reveal", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const pending = f.generate("Bird");
    f.commit();
    assert.equal(f.calls.length, i * 2);
    f.finish();
    await pending;
    f.commit();
    assert.equal(f.calls.length, (i + 1) * 2);
  }
});

test("lightbox regeneration allows its expected close-focus handoff but no later interaction", async () => {
  for (const newInteraction of [false, true]) {
    const f = fixture();
    const historyTrigger = {};
    const pending = f.generate("Bird", historyTrigger);
    f.document.activeElement = historyTrigger;
    f.document.dispatch("focusin", historyTrigger);
    if (newInteraction) f.document.dispatch("keydown", historyTrigger);
    f.finish();
    await pending;
    f.commit();
    assert.equal(f.calls.length, newInteraction ? 0 : 2);
  }
  assert.match(
    source,
    /generate\(item.prompt, lightboxReturnFocusRef.current \?\? inputRef.current\)/,
  );
});

test("a refused focus never scrolls; account reset and cleanup explicitly cancel intents", async () => {
  const f = fixture();
  f.heading.focus = () => {};
  const pending = f.generate("Bird");
  f.finish();
  await pending;
  f.commit();
  assert.deepEqual(f.calls, []);
  assert.match(
    source,
    /resetVisibleImageData = useCallback\(\(\) => \{\s*historyLoadGuardRef.current.invalidate\(\);\s*clearResultReveal\(\)/,
  );
  assert.match(
    source,
    /const historyLoadGuard = historyLoadGuardRef.current;\s*clearResultReveal\(\)/,
  );
  assert.match(
    source,
    /historyLoadGuard.invalidate\(\);\s*clearResultReveal\(\);\s*generationControllerRef.current\?\.abort\(\)/,
  );
});

test("failed requests never reclaim focus after newer interaction, navigation, or unmount", async () => {
  for (const afterResponse of [false, true])
    for (const invalidate of [
      ...["pointerdown", "keydown", "input", "wheel", "touchmove", "focusin"].map(
        (event) => (f) => f.document.dispatch(event, { name: "New work" }),
      ),
      (f) => f.router.navigate(),
      ...["popstate", "hashchange", "pagehide", "blur"].map(
        (event) => (f) => f.window.dispatch(event),
      ),
      (f) => {
        f.document.hidden = true;
        f.document.dispatch("visibilitychange");
        f.document.hidden = false;
      },
      (f) => f.unmount(),
    ]) {
      const f = fixture();
      const pending = f.generate("Old prompt");
      if (afterResponse) {
        f.finish(0, 503);
        await pending;
      }
      invalidate(f);
      f.document.activeElement = f.document.body;
      f.state.prompt = "My newer draft";
      if (!afterResponse) {
        f.finish(0, 503);
        await pending;
      }
      f.commit();
      assert.deepEqual(f.calls, []);
      assert.equal(f.state.prompt, "My newer draft");
      assert.equal(f.dependencies.resultRevealRef.current, null);
      assert.equal(f.document.count() + f.window.count(), 0);
    }
});

test("failed-request restoration rechecks account, route, current error, modal and prompt visibility", async () => {
  for (const invalidate of [
    (f) => {
      f.dependencies.resultOwnerRef.current = "other-owner";
    },
    (f) => {
      f.dependencies.resultOwnerRef.current = null;
    },
    (f) => {
      f.dependencies.generationRef.current++;
    },
    (f) => {
      f.state.error = "A newer error";
    },
    (f) => {
      f.window.location.href += "?new";
    },
    (f) => {
      f.router.state.status = "pending";
    },
    (f) => {
      f.router.state.location.pathname = "/library";
    },
    (f) => {
      f.document.hidden = true;
    },
    (f) => {
      f.document.activeElement = {};
    },
    (f) => {
      f.state.modal = {};
    },
    ...["limitOpen", "loginOpen", "settingsOpen", "lightbox"].map((modal) => (f) => {
      f.state[modal] = true;
    }),
    (f) => {
      f.promptInput.isConnected = false;
    },
    (f) => {
      f.promptInput.getClientRects = () => [];
    },
    (f) => {
      f.promptInput.closest = () => ({});
    },
    (f) => {
      f.dependencies.inputRef.current = null;
    },
  ]) {
    const f = fixture();
    const pending = f.generate("Bird");
    f.finish(0, 503);
    await pending;
    invalidate(f);
    f.commit();
    assert.deepEqual(f.calls, []);
    assert.equal(f.dependencies.resultRevealRef.current, null);
    assert.equal(f.document.count() + f.window.count(), 0);
  }
});

test("stale failures cannot change a newer intent or error", async () => {
  const f = fixture();
  const pending = f.generate("Old prompt");
  f.dependencies.generationRef.current++;
  f.dependencies.captureResultReveal(f.dependencies.generationRef.current, null);
  const newer = f.dependencies.resultRevealRef.current;
  f.requests[0].reject(new Error("Obsolete failure"));
  await pending;
  f.commit();
  assert.equal(f.dependencies.resultRevealRef.current, newer);
  assert.equal(newer.error, null);
  assert.equal(f.state.error, null);
  assert.deepEqual(f.calls, []);
  f.unmount();
});

test("failure after an earlier result returns to prompt and retry success reveals the new result", async () => {
  const f = fixture();
  let pending = f.generate("First prompt");
  f.finish();
  await pending;
  f.commit();
  f.calls.length = 0;
  pending = f.generate("Second prompt");
  f.document.activeElement = f.document.body;
  f.requests.at(-1).reject(new Error("Temporary network failure"));
  await pending;
  f.commit();
  assert.equal(f.document.activeElement, f.promptInput);
  assert.equal(f.state.prompt, "Second prompt");
  assert.equal(f.state.error, "Temporary network failure");
  assert.equal(f.state.result, "data:image/png;base64,local");
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ["prompt-focus", "prompt-scroll"],
  );
  f.calls.length = 0;
  pending = f.generate(f.state.prompt);
  f.finish();
  await pending;
  f.commit();
  assert.equal(f.state.error, null);
  assert.equal(f.document.activeElement, f.heading);
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ["focus", "scroll"],
  );
});

test("explicit Generate moves focus to its stable pending status once, then retains terminal success reveal", async () => {
  const f = fixture();
  const pending = f.generate("A paper bird");
  f.document.activeElement = f.document.body;
  f.pendingCommit();
  assert.deepEqual(f.calls, [
    ["pending-focus", { preventScroll: true }],
    ["pending-scroll", { block: "nearest", behavior: "instant" }],
  ]);
  assert.equal(f.document.activeElement, f.generationStatus);
  assert.ok(f.dependencies.resultRevealRef.current, "The managed focusin keeps terminal intent");
  f.pendingCommit();
  assert.equal(f.calls.length, 2);
  f.finish();
  await pending;
  f.commit();
  assert.equal(f.document.activeElement, f.heading);
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ["pending-focus", "pending-scroll", "focus", "scroll"],
  );
  assert.match(source, /ref=\{generationStatusRef\}\s+tabIndex=\{-1\}\s+role="status"/);
  assert.match(source, /\{loading && \(\s*<div\s+ref=\{generationStatusRef\}/);
});

test("pending handoff retains failure restoration and regeneration with an existing result", async () => {
  const f = fixture();
  f.state.result = "data:image/png;base64,prior";
  const pending = f.generate("Keep this prompt");
  f.pendingCommit();
  assert.equal(f.document.activeElement, f.generationStatus);
  f.finish(0, 503);
  await pending;
  f.commit();
  assert.equal(f.document.activeElement, f.promptInput);
  assert.equal(f.state.prompt, "Keep this prompt");
  assert.equal(f.state.result, "data:image/png;base64,prior");
});

test("new interaction before or after pending focus prevents later focus movement", async () => {
  for (const afterPending of [false, true])
    for (const event of ["pointerdown", "keydown", "input", "wheel", "touchmove", "focusin"]) {
      const f = fixture();
      const pending = f.generate("First prompt");
      if (afterPending) f.pendingCommit();
      const previousCalls = f.calls.length;
      f.document.dispatch(event, { name: "New work" });
      f.document.activeElement = f.document.body;
      f.pendingCommit();
      f.finish();
      await pending;
      f.commit();
      assert.equal(f.calls.length, previousCalls, `${event}, after pending: ${afterPending}`);
      assert.equal(f.dependencies.resultRevealRef.current, null);
    }
});

test("pending handoff rechecks owner, generation, navigation, visibility, dialogs and unmount", async () => {
  for (const invalidate of [
    (f) => {
      f.dependencies.resultOwnerRef.current = "other-owner";
    },
    (f) => {
      f.dependencies.generationRef.current++;
    },
    (f) => {
      f.router.state.status = "pending";
    },
    (f) => {
      f.router.state.location.pathname = "/library";
    },
    (f) => {
      f.window.location.href += "?other";
    },
    (f) => {
      f.document.hidden = true;
    },
    (f) => {
      f.document.activeElement = {};
    },
    (f) => {
      f.state.modal = {};
    },
    ...["limitOpen", "loginOpen", "settingsOpen", "lightbox"].map((modal) => (f) => {
      f.state[modal] = true;
    }),
    (f) => {
      f.generationStatus.isConnected = false;
    },
    (f) => {
      f.generationStatus.getClientRects = () => [];
    },
    (f) => {
      f.generationStatus.closest = () => ({});
    },
    (f) => f.router.navigate(),
    (f) => f.window.dispatch("blur"),
    (f) => f.unmount(),
  ]) {
    const f = fixture();
    const pending = f.generate("Bird");
    invalidate(f);
    f.pendingCommit();
    assert.deepEqual(f.calls, []);
    f.finish();
    await pending;
    f.unmount();
  }
});

test("a refused pending focus does not scroll or consume terminal restoration", async () => {
  const f = fixture();
  f.generationStatus.focus = () => {};
  const pending = f.generate("Bird");
  f.pendingCommit();
  assert.deepEqual(f.calls, []);
  f.finish();
  await pending;
  f.commit();
  assert.equal(f.document.activeElement, f.heading);
});
