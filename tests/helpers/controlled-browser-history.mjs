// Controlled History API event model. Executes history source without a browser or network.
import { loadUiModule, settle } from "./ui-state-harness.mjs";
export function controlledHistory(
  source = "src/vendor/tanstack-history/index.ts",
  entries = ["/work", "/library"],
  start = 0,
) {
  const window = new EventTarget();
  let index = start;
  const stack = entries.map((url, i) => ({
    url,
    state: { __TSR_index: i, __TSR_key: `key-${i}` },
  }));
  const traversals = [];
  const location = {};
  function sync() {
    Object.assign(location, new URL(stack[index].url, "https://local.test"));
    const url = new URL(stack[index].url, "https://local.test");
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  }
  window.location = location;
  window.history = {
    get state() {
      return stack[index].state;
    },
    get length() {
      return stack.length;
    },
    pushState(state, _unused, url) {
      stack.splice(index + 1);
      stack.push({ state, url });
      index++;
      sync();
    },
    replaceState(state, _unused, url) {
      stack[index] = { state, url: url ?? stack[index].url };
      sync();
    },
    go(delta) {
      traversals.push(delta);
      if (index + delta < 0 || index + delta >= stack.length) return;
      index += delta;
      sync();
      queueMicrotask(() => window.dispatchEvent(new Event("popstate")));
    },
    back() {
      this.go(-1);
    },
    forward() {
      this.go(1);
    },
  };
  sync();
  const { createBrowserHistory } = loadUiModule(
    source,
    {},
    { window, document: {}, queueMicrotask, URL },
  );
  const history = createBrowserHistory({ window });
  return { window, history, traversals, settle };
}
