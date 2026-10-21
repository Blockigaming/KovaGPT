import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/components/OnboardingDialog.tsx", "utf8"), {
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
      : [node, ...nodes(node.props?.children)];
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);

function fixture() {
  const state = [],
    effects = [],
    calls = [];
  let cursor = 0,
    rejectSave;
  const body = {};
  const document = { body, activeElement: body };
  const alertElement = {
    focus() {
      calls.push("focus-error");
      document.activeElement = alertElement;
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    react: {
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
      useMemo(run) {
        cursor++;
        return run();
      },
      useEffect(run, deps) {
        const index = cursor++;
        if (!state[index] || deps.some((value, i) => !Object.is(value, state[index].deps[i]))) {
          state[index] = { deps };
          effects.push(run);
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@tanstack/react-router": { useNavigate: () => () => calls.push("navigate") },
    "@/components/ui/dialog": Object.fromEntries(
      [
        "Dialog",
        "DialogContent",
        "DialogDescription",
        "DialogFooter",
        "DialogHeader",
        "DialogTitle",
      ].map((name) => [name, name]),
    ),
    "@/components/ui/button": { Button: "button" },
    "@/lib/onboarding.functions": {
      getOnboarding: async () => ({ completed: false }),
      saveOnboarding: () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
      skipOnboarding: async () => {
        calls.push("skip");
        throw Error("synthetic persistence failure");
      },
    },
    "@/lib/onboarding-response-policy.mjs": {
      shouldOpenOnboarding: (row) => row.completed === false,
    },
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ isSignedIn: true, isLoaded: true, user: { id: "synthetic-owner" } }),
    },
    "@/lib/chat-store": { saveDraft: () => calls.push("draft") },
    "lucide-react": {},
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    document,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  const render = () => {
    cursor = 0;
    const tree = exports.OnboardingDialog({ onCompletion: () => calls.push("completed") });
    for (const node of nodes(tree)) if (node.props.ref) node.props.ref.current = alertElement;
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  const button = (name) =>
    nodes(render()).find((node) => node.type === "button" && text(node) === name);
  const openFinalStep = async () => {
    render();
    await Promise.resolve();
    button("Work").props.onClick();
    button("Continue").props.onClick();
    button("Continue").props.onClick();
  };
  return {
    render,
    button,
    openFinalStep,
    document,
    calls,
    rejectSave: () => rejectSave(Error("synthetic save failure")),
  };
}

test("failed final save focuses the error and offers safe skip even when skip persistence fails", async () => {
  const view = fixture();
  await view.openFinalStep();
  const pending = view.button("Start chatting").props.onClick();
  assert.equal(view.button("Saving…").props.disabled, true);
  view.rejectSave();
  await pending;
  const tree = view.render();
  assert.equal(tree.props.open, true);
  const alert = nodes(tree).find((node) => node.props.role === "alert");
  assert.equal(alert.props.tabIndex, -1);
  assert.match(text(alert), /couldn't save/);
  assert.deepEqual(view.calls, ["focus-error"]);
  view.button("Skip for now").props.onClick();
  assert.equal(view.render().props.open, false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.render().props.open, false);
  assert.deepEqual(view.calls, ["focus-error", "skip"]);
});

test("a failed save does not steal focus the user moved to another control", async () => {
  const view = fixture();
  await view.openFinalStep();
  const pending = view.button("Start chatting").props.onClick();
  view.render();
  const otherControl = {};
  view.document.activeElement = otherControl;
  view.rejectSave();
  await pending;
  view.render();
  assert.equal(view.document.activeElement, otherControl);
  assert.deepEqual(view.calls, []);
  assert.ok(view.button("Skip for now"));
});

test("closing while save is pending suppresses stale error recovery and focus", async () => {
  const view = fixture();
  await view.openFinalStep();
  const pending = view.button("Start chatting").props.onClick();
  view.render().props.onOpenChange(false);
  view.rejectSave();
  await pending;
  const tree = view.render();
  assert.equal(tree.props.open, false);
  assert.equal(
    nodes(tree).some((node) => node.props.role === "alert"),
    false,
  );
  assert.deepEqual(view.calls, ["skip"]);
});
