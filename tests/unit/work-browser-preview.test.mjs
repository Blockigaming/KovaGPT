import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/components/WorkBrowserPanel.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children), ...nodes(node.props?.actions)];
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);
const ownerId = "22222222-2222-4222-8222-222222222222",
  runId = "33333333-3333-4333-8333-333333333333",
  sessionId = "44444444-4444-4444-8444-444444444444",
  targetId = "55555555-5555-4555-8555-555555555555";

function fixture(options = {}) {
  const state = [],
    effects = [],
    requests = [],
    controller = new AbortController();
  let cursor = 0,
    tree,
    clear,
    rejectAction = false,
    rejectRead = false,
    sequence = 1,
    mode = options.mode ?? "takeover",
    closed = false;
  const run = {
    id: runId,
    revision: 3,
    status: "paused",
    step: null,
    effect: null,
    ...options.run,
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const index = cursor++;
      state[index] ??= { value: initial };
      return [
        state[index].value,
        (next) => {
          state[index].value = typeof next === "function" ? next(state[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      state[index] ??= { current: initial };
      return state[index];
    },
    useEffectEvent: (callback) => callback,
    useEffect(effect, deps) {
      const index = cursor++;
      if (!state[index] || deps.some((value, i) => !Object.is(value, state[index].deps[i]))) {
        state[index] = { deps };
        effects.push(effect);
      }
    },
  };
  const modules = {
    react,
    "@/components/ui/input": { Input: "input" },
    "@/components/BrowserPrivateEntryCard": { BrowserPrivateEntryCard: "private-entry-card" },
    "@/components/BrowserInteractionCard": { BrowserInteractionCard: "browser-interaction-card" },
    "@/components/BrowserWorkspace": { BrowserWorkspace: "browser-workspace" },
    "@/components/WorkBrowserViewport": { WorkBrowserViewport: "browser-viewport" },
    "@/components/ui/button": { Button: "button" },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { ChevronDown: "svg", Globe2: "svg", Monitor: "svg" },
    "./work-browser-preview.css": {},
    "@/components/ui/select": Object.fromEntries(
      ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
        name,
        name,
      ]),
    ),
    "@/lib/work-view-lifetime.mjs": {
      createWorkViewLifetime(owner, callback) {
        assert.equal(owner, ownerId);
        clear = () => {
          controller.abort();
          callback();
        };
        return {
          controller,
          dispose() {
            controller.abort();
          },
        };
      },
    },
    "@/lib/work-sync-client": {
      async requestWorkSync(owner, path, signal, body) {
        assert.equal(owner, ownerId);
        assert.equal(signal, controller.signal);
        requests.push({ path, ...(body ? { body: structuredClone(body) } : {}) });
        if (!body) {
          if (rejectRead) throw Error("status unavailable");
          return {
            readiness: { available: true, visualTakeover: true },
            runRevision: options.snapshotRevision ?? run.revision,
            runStatus: options.snapshotStatus ?? run.status,
            sessions: closed
              ? []
              : [
                  {
                    id: sessionId,
                    sequence,
                    mode,
                    expires_at: new Date(Date.now() + 300000).toISOString(),
                  },
                ],
          };
        }
        if (options.hold) await options.hold;
        if (rejectAction) throw Error("unconfirmed");
        if (body.visual?.kind !== "frame") sequence++;
        if (body.operation === "release") mode = "agent";
        if (body.operation === "takeover") mode = "takeover";
        if (body.operation === "close") closed = true;
        return {
          expiresAt: Date.now() + 300000,
          result: {
            sessionId,
            runId,
            sequence: options.badSequence ? sequence + 1 : sequence,
            mode,
            ...(closed ? { closed: true } : {}),
            url: "https://browser-fixture.net/account",
            ...(mode === "takeover" && !closed
              ? {
                  frame: { id: "fixture-frame", jpeg: "fixture-jpeg", width: 1280, height: 900 },
                  title: "Private fixture",
                  text: '<img src=x onerror="injectedBrowser=true"> Safe account page',
                  view: "current-page-view",
                  nodes: [
                    {
                      id: targetId,
                      label: "Password",
                      kind: "input",
                      inputType: "password",
                      editable: true,
                      disabled: false,
                    },
                  ],
                }
              : {}),
          },
        };
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    crypto,
    Date,
    Error,
    URL,
    Number,
    window: { setTimeout() {}, clearTimeout() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  const render = () => {
    cursor = 0;
    tree = exports.WorkBrowserPanel({ ownerId, run });
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 4; i++) {
      render();
      for (const effect of effects.splice(0)) effect();
      await new Promise((resolve) => setImmediate(resolve));
    }
    render();
  };
  const find = (type, predicate) => {
    const found = nodes(tree).find((node) => node.type === type && predicate(node));
    assert.ok(found, `Missing ${type}`);
    return found;
  };
  const button = (label) =>
    find("button", (node) => (node.props["aria-label"] ?? text(node)) === label);
  const click = async (label) => {
    const node = button(label);
    assert.notEqual(node.props.disabled, true, `${label} disabled`);
    await node.props.onClick();
    await flush();
  };
  return {
    flush,
    render,
    click,
    button,
    find,
    requests,
    run,
    clear() {
      clear();
    },
    rejectAction(value) {
      rejectAction = value;
    },
    rejectRead(value) {
      rejectRead = value;
    },
    changeSequence() {
      sequence++;
    },
    get tree() {
      return tree;
    },
    get commands() {
      return requests.filter((request) => request.body).map((request) => request.body);
    },
  };
}

test("the opened view contains the live page and session actions", async () => {
  const f = fixture({ mode: "agent" });
  await f.flush();
  await f.click("Take over");
  const workspace = f.find("browser-workspace", () => true);
  assert.equal(workspace.props.title, "Cloud browser");
  assert.equal(f.find("browser-viewport", () => true).props.frame.id, "fixture-frame");
  assert.equal(text(workspace), "");
  assert.equal(text(workspace.props.actions), "Return control");
  assert.ok(!text(f.tree).includes("Safe account page"));
});

test("takeover requires a confirmed paused revision with no active step or started effect", async () => {
  for (const options of [
    { run: { status: "running" } },
    { run: { step: { id: "active-step" } } },
    { run: { effect: { status: "started" } } },
    { snapshotStatus: "running" },
    { snapshotRevision: 4 },
  ]) {
    const f = fixture({ mode: "agent", ...options });
    await f.flush();
    const button = f.button("Take over");
    assert.equal(button.props.disabled, true);
    button.props.onClick(); // The command guard also blocks a stale/programmatic handler.
    await f.flush();
    assert.equal(f.commands.length, 0);
    assert.notEqual(f.button("End session").props.disabled, true);
  }
});

test("takeover, return and end use exact existing operations; returning control does not resume the run", async () => {
  const f = fixture({ mode: "agent" });
  await f.flush();
  await f.click("Take over");
  const workspace = f.find("browser-workspace", () => true);
  assert.equal(text(workspace.props.actions), "Return control");
  assert.deepEqual(f.commands[0], {
    expectedUserId: ownerId,
    runId,
    sessionId,
    expectedRevision: 3,
    expectedSequence: 1,
    operation: "takeover",
    visual: { kind: "capture" },
  });
  assert.equal(f.find("browser-viewport", () => true).props.frame.id, "fixture-frame");
  await f.click("Return control");
  assert.equal(f.commands[1].operation, "release");
  assert.equal(f.commands[1].expectedSequence, 2);
  assert.match(text(f.tree), /Agent has control/);
  assert.equal(f.run.status, "paused");
  assert.ok(f.requests.every(({ path }) => path.startsWith("/api/work/browser")));
  assert.equal(text(f.tree).includes("Safe account page"), false);
  f.run.status = "running";
  f.run.revision++;
  await f.flush();
  await f.click("End session");
  assert.equal(f.commands[2].operation, "close");
  assert.equal(f.commands[2].expectedRevision, 4);
  assert.match(text(f.tree), /No open session/);
});

test("closing the workspace discards its frame without ending the browser", async () => {
  const f = fixture({ mode: "agent" });
  await f.flush();
  await f.click("Take over");
  f.find("browser-workspace", () => true).props.onClose();
  await f.flush();
  assert.equal(
    nodes(f.tree).some((node) => node.type === "browser-viewport"),
    false,
  );
  assert.notEqual(f.button("Open browser").props.disabled, true);
  assert.equal(f.commands.length, 1);
});

test("failed or mismatched actions lock further control until a fresh authoritative read", async () => {
  for (const badSequence of [false, true]) {
    const f = fixture({ mode: "agent", badSequence });
    await f.flush();
    f.rejectAction(!badSequence);
    await f.click("Take over");
    assert.equal(f.button("Take over").props.disabled, true);
    assert.match(text(f.tree), /The last browser action could not be confirmed/);
    f.rejectAction(false);
    await f.click("Reconnect");
    if (badSequence) assert.equal(f.button("Return control").props.disabled, false);
    else assert.equal(f.button("Take over").props.disabled, false);
  }
});

test("sending an owner click forwards the coordinates and current sequence", async () => {
  const f = fixture({ mode: "agent" });
  await f.flush();
  await f.click("Take over");
  f.find("browser-viewport", () => true).props.onInput({
    kind: "click",
    frame: "fixture-frame",
    x: 50,
    y: 50,
  });
  await f.flush();
  assert.equal(f.commands[1].operation, "snapshot");
  assert.equal(f.commands[1].expectedSequence, 2);
  assert.deepEqual(f.commands[1].visual, { kind: "click", frame: "fixture-frame", x: 50, y: 50 });
});

test("repeated clicks do not duplicate a command and owner clear rejects a delayed preview", async () => {
  let release;
  const hold = new Promise((resolve) => (release = resolve));
  const f = fixture({ mode: "agent", hold });
  await f.flush();
  const button = f.button("Take over");
  button.props.onClick();
  button.props.onClick();
  await f.flush();
  assert.equal(f.commands.length, 1);
  f.clear();
  release();
  await f.flush();
  assert.match(text(f.tree), /Private browser controls were cleared/);
  assert.equal(text(f.tree).includes("Safe account page"), false);
  assert.equal(
    nodes(f.tree).some((node) => node.type === "section"),
    false,
  );
});
