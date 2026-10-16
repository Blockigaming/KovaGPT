import test from "node:test";
import assert from "node:assert/strict";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  settle,
  deferred,
} from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/discovery/discovery-policy.mjs";
function fixture() {
  const outer = createHookHarness();
  let inner = createHookHarness(),
    hooks = outer,
    blocker,
    mode = "web";
  const auth = { isLoaded: true, user: { id: "owner-a" } },
    requests = [],
    copies = [],
    downloads = [],
    confirmations = [],
    stateCommits = [];
  const clipboard = { writeText: async (v) => copies.push(v) };
  const window = new EventTarget();
  window.confirm = (message) => {
    confirmations.push(message);
    return false;
  };
  const { DiscoveryWorkspace } = loadUiModule(
    "src/components/DiscoveryWorkspace.tsx",
    {
      react: new Proxy(
        {},
        {
          get: (_, k) =>
            k !== "useState"
              ? hooks.react[k]
              : (initial) => {
                  const [value, set] = hooks.react.useState(initial);
                  return [
                    value,
                    (next) =>
                      set((old) => {
                        const result = typeof next === "function" ? next(old) : next;
                        stateCommits.push(result);
                        return result;
                      }),
                  ];
                },
        },
      ),
      "@tanstack/react-router": {
        Link: "Link",
        useBlocker: (v) => {
          blocker = v;
        },
      },
      "@/components/auth/ClerkSafe": { useUser: () => auth, SignInButton: "SignInButton" },
      "@/components/ui/button": { Button: "Button" },
      "@/lib/discovery/discovery-browser": {
        discoveryApiRequest: (actor, signal, input) => {
          if (!input) return Promise.resolve({ response: { ok: true }, data: { enabled: true } });
          const d = deferred();
          requests.push({ ...d, actor, signal, input });
          return d.promise;
        },
      },
      "@/lib/principal-browser-storage.mjs": {
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "cleared",
        isPrincipalBrowserStorageClearedEvent: (e, id) => e.detail === id,
      },
      "@/lib/discovery/discovery-policy.mjs": policy,
    },
    {
      window,
      AbortController,
      setTimeout,
      clearTimeout,
      URL: class extends URL {
        static createObjectURL(b) {
          downloads.push(b);
          return "blob:test";
        }
        static revokeObjectURL() {}
      },
      Blob,
      navigator: { clipboard },
      document: { createElement: () => ({ click() {}, remove() {} }) },
    },
  );
  let props, key;
  function render() {
    hooks = outer;
    const el = outer.render(DiscoveryWorkspace, { initialMode: mode });
    props = el.props;
    if (key !== undefined && key !== el.key) {
      inner.unmount();
      inner = createHookHarness();
    }
    key = el.key;
    hooks = inner;
    return inner.render(el.type, props);
  }
  const button = (label) =>
    elements(render(), (n) => n.type === "Button" && text(n).trim() === label)[0];
  const input = (i = 0) => elements(render(), (n) => n.type === "input")[i];
  const enter = (value, i = 0) => input(i).props.onChange({ target: { value } });
  return {
    render,
    button,
    input,
    enter,
    requests,
    copies,
    downloads,
    auth,
    window,
    confirmations,
    clipboard,
    stateCommits,
    get blocker() {
      return blocker;
    },
    get key() {
      return key;
    },
    setMode(v) {
      mode = v;
    },
    dispose() {
      inner.unmount();
      outer.unmount();
    },
  };
}
test("mode changes preserve independent query and manually entered Local location", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    f.enter("Web draft");
    f.button("Local places").props.onClick();
    f.enter("Cafe draft");
    f.enter("My neighborhood", 1);
    f.button("Images").props.onClick();
    assert.equal(f.input().props.value, "");
    f.enter("Image draft");
    f.button("Web").props.onClick();
    assert.equal(f.input().props.value, "Web draft");
    f.button("Local places").props.onClick();
    assert.equal(f.input().props.value, "Cafe draft");
    assert.equal(f.input(1).props.value, "My neighborhood");
  } finally {
    f.dispose();
  }
});

for (const transition of ["clear", "mode"]) {
  test(`response validation followed by ${transition} before consumer continuation cannot restore results`, async () => {
    const f = fixture();
    try {
      f.render();
      await settle();
      f.enter("Retired query");
      elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      const data = {
        operation: "search",
        mode: "web",
        query: "Retired query",
        location: "",
        observedAt: "2026-10-12",
        results: [{ url: "https://example.test", title: "Retired result" }],
      };
      f.requests[0].resolve({
        response: {
          get ok() {
            queueMicrotask(() => {
              if (transition === "clear") f.button("Clear query").props.onClick();
              else {
                f.setMode("images");
                f.render();
              }
            });
            return true;
          },
        },
        data,
      });
      await settle();
      assert.equal(f.requests[0].signal.aborted, true);
      assert.doesNotMatch(text(f.render()), /Retired result|results for/);
    } finally {
      f.dispose();
    }
  });
}
test("URL mode change preserves the account session identity while account changes reset it", () => {
  const f = fixture();
  try {
    f.render();
    const key = f.key;
    f.setMode("local");
    f.render();
    assert.equal(f.key, key);
    f.auth.user = { id: "owner-b" };
    f.render();
    assert.notEqual(f.key, key);
  } finally {
    f.dispose();
  }
});
test("navigation away is guarded while mode query changes keep drafts without a discard prompt", () => {
  const f = fixture();
  try {
    f.render();
    f.enter("Unsent query");
    f.render();
    assert.ok(f.blocker);
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(
      f.blocker.shouldBlockFn({ current: { pathname: "/discovery" }, next: { pathname: "/work" } }),
      true,
    );
    assert.equal(
      f.blocker.shouldBlockFn({
        current: { pathname: "/discovery" },
        next: { pathname: "/discovery" },
      }),
      false,
    );
    assert.equal(f.input().props.value, "Unsent query");
  } finally {
    f.dispose();
  }
});
test("copy and download use current query fields without clearing the unsaved draft", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    const copy = f.button("Copy query").props.onClick,
      download = f.button("Download query").props.onClick,
      field = f.input();
    field.props.onChange({ target: { value: "Current Unicode query ✨" } });
    // Invoke the existing handlers before another render: final keystroke must survive.
    await copy();
    assert.match(f.copies[0], /Current Unicode query ✨/);
    download();
    assert.match(await f.downloads[0].text(), /Current Unicode query ✨/);
    assert.equal(f.input().props.value, "Current Unicode query ✨");
    assert.equal(f.blocker.enableBeforeUnload, true);
  } finally {
    f.dispose();
  }
});
test("Clear query aborts pending work and ignores late results without clearing another mode", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    f.enter("Keep web");
    f.button("Local places").props.onClick();
    f.enter("Old local");
    f.enter("Old place", 1);
    elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    assert.equal(f.requests.length, 1);
    f.button("Clear query").props.onClick();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].resolve({
      response: { ok: true },
      data: {
        operation: "search",
        mode: "local",
        query: "Old local",
        location: "Old place",
        observedAt: "2026-10-12",
        results: [{ url: "https://example.test", title: "Late result" }],
      },
    });
    await settle();
    assert.doesNotMatch(text(f.render()), /Late result/);
    assert.equal(f.input().props.value, "");
    assert.equal(f.input(1).props.value, "");
    f.button("Web").props.onClick();
    assert.equal(f.input().props.value, "Keep web");
  } finally {
    f.dispose();
  }
});

test("account change aborts delayed results and starts with empty per-mode drafts", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    f.enter("Private A query");
    elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    f.auth.user = { id: "owner-b" };
    f.render();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].resolve({
      response: { ok: true },
      data: {
        operation: "search",
        mode: "web",
        query: "Private A query",
        location: "",
        observedAt: "2026-10-12",
        results: [{ url: "https://example.test", title: "Private A result" }],
      },
    });
    await settle();
    assert.equal(f.input().props.value, "");
    assert.doesNotMatch(text(f.render()), /Private A/);
  } finally {
    f.dispose();
  }
});
test("failed or delayed clipboard completion keeps newer edits and does not announce an old query", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    f.enter("First");
    const d = deferred();
    f.clipboard.writeText = () => d.promise;
    const pending = f.button("Copy query").props.onClick();
    f.enter("Newer");
    d.resolve();
    await pending;
    assert.doesNotMatch(text(f.render()), /Query copied/);
    assert.equal(f.input().props.value, "Newer");
    f.clipboard.writeText = async () => {
      throw Error("denied");
    };
    await f.button("Copy query").props.onClick();
    assert.match(text(f.render()), /Copy failed/);
    assert.equal(f.input().props.value, "Newer");
    assert.equal(f.blocker.enableBeforeUnload, true);
  } finally {
    f.dispose();
  }
});
test("URL mode change cancels a pending search but preserves the original mode draft", async () => {
  const f = fixture();
  try {
    f.render();
    await settle();
    f.enter("Keep on return");
    elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    f.setMode("images");
    f.render();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].resolve({
      response: { ok: true },
      data: {
        operation: "search",
        mode: "web",
        query: "Keep on return",
        location: "",
        observedAt: "2026-10-12",
        results: [{ url: "https://example.test", title: "Stale route result" }],
      },
    });
    await settle();
    assert.equal(f.input().props.value, "");
    assert.doesNotMatch(text(f.render()), /Stale route result/);
    f.setMode("web");
    f.render();
    assert.equal(f.input().props.value, "Keep on return");
  } finally {
    f.dispose();
  }
});

for (const transition of ["clear", "mode"]) {
  test(`product validation followed by ${transition} cannot commit retired product data`, async () => {
    const f = fixture();
    try {
      f.setMode("shopping");
      f.render();
      await settle();
      f.enter("Shoes");
      elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      f.requests[0].resolve({
        response: { ok: true },
        data: {
          operation: "search",
          mode: "shopping",
          query: "Shoes",
          location: "",
          observedAt: "2026-10-12",
          results: [{ url: "https://example.test/shoes", title: "Shoes", sourceToken: "token" }],
        },
      });
      await settle();
      f.button("Check merchant details").props.onClick();
      f.requests[1].resolve({
        response: {
          get ok() {
            queueMicrotask(() => {
              if (transition === "clear") f.button("Clear query").props.onClick();
              else {
                f.setMode("web");
                f.render();
              }
            });
            return true;
          },
        },
        data: { operation: "product", product: { title: "Retired product sentinel" } },
      });
      await settle();
      assert.equal(f.requests[1].signal.aborted, true);
      assert.ok(
        !f.stateCommits.some((value) =>
          JSON.stringify(value)?.includes("Retired product sentinel"),
        ),
      );
    } finally {
      f.dispose();
    }
  });
}
