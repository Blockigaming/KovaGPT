import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
export const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);

// A deterministic hook renderer drives real component callbacks; only React's
// scheduling/DOM and explicit external boundaries are replaced.
export function reactFixture(path, select, options = {}) {
  const hooks = [],
    effects = [],
    messages = [],
    calls = [];
  let cursor = 0,
    tree;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const i = cursor++;
      hooks[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        hooks[i].value,
        (next) => {
          hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      hooks[i] ??= { current: initial };
      return hooks[i];
    },
    useCallback(run, deps) {
      const i = cursor++;
      if (!hooks[i] || deps.some((x, j) => !Object.is(x, hooks[i].deps[j])))
        hooks[i] = { value: run, deps };
      return hooks[i].value;
    },
    useEffect(run, deps) {
      const i = cursor++;
      if (!hooks[i] || deps.some((x, j) => !Object.is(x, hooks[i].deps[j]))) {
        hooks[i]?.cleanup?.();
        hooks[i] = { deps, run };
        effects.push(() => {
          hooks[i].cleanup = run();
        });
      }
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": {},
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    sonner: {
      toast: {
        success: (m) => messages.push(["success", m]),
        error: (m) => messages.push(["error", m]),
      },
    },
    ...options.modules,
  };
  const compiled = ts.transpileModule(
    readFileSync(path, "utf8").replaceAll("import.meta.env", "__env"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Error,
    Response,
    Date,
    URL,
    TextEncoder,
    TextDecoder,
    __env: {},
    ...options.globals,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  const render = () => {
    cursor = 0;
    tree = select(exports)();
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      render();
      for (const effect of effects.splice(0)) effect();
      await new Promise((r) => setImmediate(r));
    }
    render();
  };
  const find = (type, predicate = () => true) => {
    const n = nodes(tree).find((n) => n.type === type && predicate(n));
    assert.ok(n, `Missing ${type}`);
    return n;
  };
  const click = async (label) => {
    const n = find("button", (n) => text(n) === label || n.props["aria-label"] === label);
    assert.notEqual(n.props.disabled, true);
    await n.props.onClick();
    await flush();
  };
  const input = async (id, value) => {
    find("input", (n) => n.props.id === id).props.onChange({ target: { value } });
    await flush();
  };
  return {
    render,
    flush,
    find,
    click,
    input,
    calls,
    messages,
    nodes: () => nodes(tree),
    text: () => text(tree),
    unmount: () => hooks.forEach((h) => h.cleanup?.()),
    replayEffects: () =>
      hooks.forEach((h) => {
        if (h.run) {
          h.cleanup?.();
          h.cleanup = h.run();
        }
      }),
    submit: () => find("form").props.onSubmit({ preventDefault() {} }),
    get tree() {
      return tree;
    },
  };
}
