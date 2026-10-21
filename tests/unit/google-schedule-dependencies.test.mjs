import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  createHookHarness,
  deferred,
  elements,
  jsxRuntime,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const source = readFileSync("src/lib/google-schedule-dependencies.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { findKnownGoogleScheduleDependencies: find, GOOGLE_DEPENDENCY_DISPLAY_LIMIT } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const id = (value) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = id(1),
  account = id(2),
  otherAccount = id(3),
  grantId = id(4);
const now = Date.parse("2026-10-19T00:00:00Z");
const grant = (overrides = {}) => ({
  id: grantId,
  provider: "gmail",
  connection_ref: account,
  expires_at: "2099-01-01T00:00:00Z",
  ...overrides,
});
const ref = (overrides = {}) => ({ kind: "connected", provider: "gmail", grantId, ...overrides });
const task = (overrides = {}) => ({
  id: id(5),
  title: "Morning inbox",
  context_refs: [ref()],
  event_triggers: [],
  ...overrides,
});

test("joins both context and event grant IDs to the exact Google connection and deduplicates tasks", () => {
  const tasks = [
    task({ event_triggers: [ref()] }),
    task({ id: id(6), title: "Important mail", context_refs: [], event_triggers: [ref()] }),
    task({ id: id(7), context_refs: [{ kind: "library", id: id(70) }] }),
  ];
  const result = find(account, tasks, [grant()], now);
  assert.equal(result.knownCount, 2);
  assert.deepEqual(
    result.schedules.map((value) => value.title),
    ["Morning inbox", "Important mail"],
  );
  assert.equal(result.schedules[0].href, `/scheduled-tasks?taskId=${id(5)}`);
});

test("never guesses account IDs, grants, providers, or expired authorization", () => {
  for (const grants of [
    [],
    [grant({ connection_ref: otherAccount })],
    [grant({ id: id(44) })],
    [grant({ provider: "github" })],
    [grant({ provider: "slack" })],
    [grant({ expires_at: "2026-10-19T00:00:00Z" })],
    [grant({ expires_at: "2025-10-19T00:00:00Z" })],
  ])
    assert.equal(find(account, [task()], grants, now).knownCount, 0);
  for (const provider of ["github", "slack"])
    assert.equal(
      find(account, [task({ context_refs: [ref({ provider })] })], [grant()], now).knownCount,
      0,
    );
  assert.equal(
    find(account, [task({ context_refs: [ref({ grantId: account })] })], [grant()], now).knownCount,
    0,
  );
});

test("retains all saved task statuses without inferring future execution and caps rendered results", () => {
  const tasks = Array.from({ length: 25 }, (_, index) =>
    task({
      id: id(100 + index),
      status: ["paused", "completed", "failed", "running", "scheduled"][index % 5],
    }),
  );
  const result = find(account, tasks, [grant()], now);
  assert.equal(result.knownCount, 25);
  assert.equal(result.schedules.length, GOOGLE_DEPENDENCY_DISPLAY_LIMIT);
});

test("malformed or over-bound data is unavailable rather than a false empty result", () => {
  for (const tasks of [
    null,
    {},
    [task({ id: "javascript:bad" })],
    [task({ context_refs: null })],
    [task({ event_triggers: [null] })],
    [task({ context_refs: [ref({ provider: "unknown" })] })],
    [task(), task()],
    Array.from({ length: 5001 }, () => task()),
  ])
    assert.throws(() => find(account, tasks, [grant()], now), /unavailable/);
  for (const grants of [
    undefined,
    [null],
    [grant({ expires_at: "invalid" })],
    [grant(), grant()],
    [grant({ connection_ref: "bad" })],
    Array.from({ length: 21 }, () => grant()),
  ])
    assert.throws(() => find(account, [task()], grants, now), /unavailable/);
  assert.throws(() => find("", [], [], now), /unavailable/);
});

const route = readFileSync("src/routes/apps.tsx", "utf8");
const ast = ts.createSourceFile("apps.tsx", route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "GoogleDisconnectSchedules",
);
const React = {
  Fragment: jsxRuntime.Fragment,
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
};
const evaluate = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(deps));
function fixture(props = { userId: owner, connectionId: account }) {
  const hooks = createHookHarness(),
    requests = [],
    timers = new Map();
  let timerId = 0;
  const request = (kind) => (args) => {
    const pending = deferred();
    requests.push({ kind, args, ...pending });
    return pending.promise;
  };
  const component = evaluate(`return (${declaration.getText(ast)});`, {
    React,
    ...hooks.react,
    useServerFn: (fn) => fn,
    listScheduledTasks: request("tasks"),
    listScheduledTaskConnections: request("connections"),
    findKnownGoogleScheduleDependencies: find,
    Button: "button",
    window: {
      setTimeout(fn) {
        timers.set(++timerId, fn);
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  });
  return {
    hooks,
    requests,
    timers,
    render: () => hooks.render(component, props),
    resolve(tasks = [task()], grants = [grant()], start = 0) {
      requests[start].resolve(tasks);
      requests[start + 1].resolve({ connections: [], grants });
    },
  };
}

test("review uses exactly two owner-bound reads and exposes loading, linked names and partial coverage", async () => {
  const f = fixture();
  const loading = f.render();
  assert.match(text(loading), /Checking known scheduled tasks/);
  assert.match(text(loading), /Partial coverage.*active, unexpired.*Expired or revoked/s);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((request) => request.args.data.expectedUserId === owner));
  f.resolve();
  await settle();
  const ready = f.render();
  const link = elements(ready, (element) => element.props.href?.includes("taskId="))[0];
  assert.equal(text(link), "Morning inbox");
  assert.equal(link.props.href, `/scheduled-tasks?taskId=${id(5)}`);
  assert.match(text(ready), /project dependencies are not included/);
  assert.equal(f.requests.length, 2);
  assert.equal(f.timers.size, 0);
});

test("successful limited no-match reads never state that no dependencies exist", async () => {
  const f = fixture();
  f.render();
  f.resolve([task()], []);
  await settle();
  const copy = text(f.render());
  assert.match(
    copy,
    /No known matching schedules.*limited check.*Other dependencies may still exist/s,
  );
  assert.match(copy, /Partial coverage/);
  assert.doesNotMatch(copy, /0 dependencies|no dependent workflows|no dependencies/i);
});

test("either read failure and malformed reads offer an explicit unavailable state and retry", async () => {
  for (const failure of ["tasks", "connections", "malformed"]) {
    const f = fixture();
    f.render();
    if (failure === "malformed") f.resolve(null);
    else {
      f.requests.find((request) => request.kind === failure).reject(new Error("read unavailable"));
      f.requests
        .find((request) => request.kind !== failure)
        .resolve(failure === "tasks" ? { grants: [] } : []);
    }
    await settle();
    const failed = f.render();
    assert.match(text(failed), /could not be checked/);
    assert.doesNotMatch(text(failed), /No known matching/);
    elements(failed, (element) => element.type === "button")[0].props.onClick();
    f.render();
    assert.match(text(f.render()), /Checking known scheduled tasks/);
    assert.equal(f.requests.length, 4);
    f.resolve(undefined, undefined, 2);
    await settle();
    assert.match(text(f.render()), /Morning inbox/);
  }
});

test("timeouts settle as unavailable and late results cannot replace retry results", async () => {
  const f = fixture();
  f.render();
  [...f.timers.values()][0]();
  const failed = f.render();
  assert.match(text(failed), /could not be checked/);
  elements(failed, (element) => element.type === "button")[0].props.onClick();
  f.render();
  f.resolve([task({ title: "New check" })], [grant()], 2);
  await settle();
  f.resolve([task({ title: "Old check" })]);
  await settle();
  assert.match(text(f.render()), /New check/);
  assert.doesNotMatch(text(f.render()), /Old check/);
});

test("close and keyed account changes ignore old pending reads and start fresh owner-scoped review", async () => {
  const previous = fixture();
  previous.render();
  previous.hooks.unmount();
  assert.equal(previous.timers.size, 0);
  const next = fixture({ userId: id(20), connectionId: otherAccount });
  next.render();
  previous.resolve([task({ title: "Previous owner secret" })]);
  await settle();
  assert.match(text(next.render()), /Checking known/);
  assert.doesNotMatch(text(next.render()), /Previous owner secret/);
  assert.equal(next.requests[0].args.data.expectedUserId, id(20));
  next.resolve([task({ title: "Current owner" })], [grant({ connection_ref: otherAccount })]);
  await settle();
  assert.match(text(next.render()), /Current owner/);
  assert.match(
    route,
    /key=\{`\$\{principal\}:\$\{lifecycleVersion\}:\$\{pendingGoogleDisconnect.id\}/,
  );
  assert.match(route, /open=\{activityReady && isSignedIn && pendingGoogleDisconnect !== null\}/);
});

test("confirmation content is read-only and preserves the shared confirmation defaults and cancel", () => {
  const names = [
    "AlertDialog",
    "AlertDialogAction",
    "AlertDialogCancel",
    "AlertDialogContent",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogHeader",
    "AlertDialogTitle",
  ];
  const { ConfirmActionDialog } = loadUiModule("src/components/ConfirmActionDialog.tsx", {
    "lucide-react": { AlertTriangle: "AlertTriangle" },
    "@/components/ui/alert-dialog": Object.fromEntries(names.map((name) => [name, name])),
  });
  let confirmations = 0;
  const props = {
    open: true,
    onOpenChange() {},
    title: "Disconnect?",
    description: "Consequence",
    confirmLabel: "Disconnect account",
    onConfirm() {
      confirmations++;
    },
    destructive: true,
    disabled: true,
  };
  const plain = ConfirmActionDialog(props);
  const content = jsxRuntime.jsx("section", { children: "Read-only schedule review" });
  const withReview = ConfirmActionDialog({ ...props, children: content });
  const action = (tree) => elements(tree, (element) => element.type === "AlertDialogAction")[0];
  const cancel = (tree) => elements(tree, (element) => element.type === "AlertDialogCancel")[0];
  assert.deepEqual(action(plain), action(withReview));
  assert.deepEqual(cancel(plain), cancel(withReview));
  assert.equal(action(plain).props.disabled, true);
  assert.equal(cancel(withReview).props.disabled, undefined);
  assert.equal(confirmations, 0);
  const enabled = ConfirmActionDialog({ ...props, disabled: false });
  action(enabled).props.onClick();
  assert.equal(confirmations, 1);
  assert.equal(elements(plain, (element) => element.type === "section").length, 0);
  const ordered = elements(withReview).map((element) => element.type);
  assert.ok(ordered.indexOf("section") < ordered.indexOf("AlertDialogFooter"));
  assert.doesNotMatch(
    declaration.getText(ast),
    /disconnectGoogleAccount|disconnectGitHub|grantScheduledTaskConnection/,
  );
  assert.match(route, /if \(account\) void changeGoogleAccount\("disconnect", account.id\)/);
});

test("disconnect review captures its exact opener and guards return against account/lifecycle changes", () => {
  const route = readFileSync("src/routes/apps.tsx", "utf8");
  assert.match(
    route,
    /googleDisconnectReturnRef\.current = \{\s*trigger: event\.currentTarget,\s*url: window\.location\.href,\s*principal: principalRef\.current,\s*generation: generationRef\.current,/,
  );
  assert.match(
    route,
    /const origin = googleDisconnectReturnRef\.current;\s*googleDisconnectReturnRef\.current = null;\s*restoreDialogFocus\(\s*origin\?\.trigger,\s*origin\?\.url,\s*origin\?\.principal !== principalRef\.current \|\|\s*origin\?\.generation !== generationRef\.current/,
  );
});
