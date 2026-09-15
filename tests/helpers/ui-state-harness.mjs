// Small, explicit hook/element harness for event and async state regressions.
// This executes the source components; it is not DOM, Radix, or browser evidence.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
  Fragment: Symbol("Fragment"),
};

export function loadUiModule(path, dependencies, globals = {}) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(id) {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      throw new Error(`Unexpected dependency ${id} in ${path}`);
    },
    console,
    ...globals,
  });
  return module.exports;
}

export function createHookHarness() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? initial() : initial;
      }
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        pending.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
    useId() {
      const index = cursor++;
      return `fixture-${index}`;
    },
    forwardRef: (render) => (props) => render(props, null),
  };
  return {
    react,
    render(component, props = {}) {
      cursor = 0;
      const tree = component(props);
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
      return tree;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

export function elements(tree, predicate = () => true) {
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, predicate));
  if (!tree || typeof tree !== "object" || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props.children, predicate)];
}

export function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
