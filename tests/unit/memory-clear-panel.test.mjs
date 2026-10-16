import test from "node:test";
import assert from "node:assert/strict";
import { createHookHarness, loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const hooks = createHookHarness(),
    window = new EventTarget(),
    requests = [],
    changes = [],
    busy = [];
  let principal = "a",
    answer = true,
    duringConfirm = () => {},
    available = true;
  window.confirm = () => {
    duringConfirm();
    return answer;
  };
  const availability = async () => ({ available, seconds: 600 });
  const change = ({ data }) =>
    new Promise((resolve, reject) => requests.push({ data, resolve, reject }));
  const onBusy = (value) => busy.push(value);
  const { MemoryClearPanel } = loadUiModule(
    "src/components/MemoryClearPanel.tsx",
    {
      react: hooks.react,
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/lib/memory-clear.functions": {
        memoryClearAvailability: availability,
        changeMemoryClear: change,
      },
      "@/lib/principal-browser-storage.mjs": {
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "reset",
        isPrincipalBrowserStorageClearedEvent: () => true,
      },
    },
    { window, crypto },
  );
  const render = () =>
    hooks.render(MemoryClearPanel, {
      ownerId: principal,
      disabled: false,
      onBusy,
      onChanged: async (current) => {
        if (current()) changes.push(principal);
      },
    });
  const button = (label) =>
    elements(
      render(),
      (node) => node.type === "button" && text(node).replace(/\s+/g, " ").trim() === label,
    )[0];
  const respond = (index, state = "active", extra = {}) =>
    requests[index].resolve({
      operationId: requests[index].data.operationId,
      state,
      removedCount: 2,
      restoredCount: 2,
      skippedCount: 0,
      expiresAt: "2026-10-13T12:00:00Z",
      ...extra,
    });
  return {
    render,
    button,
    requests,
    changes,
    busy,
    respond,
    window,
    async ready() {
      render();
      await tick();
      render();
    },
    setOwner(v) {
      principal = v;
      render();
    },
    cancel() {
      answer = false;
    },
    confirmWith(fn) {
      duringConfirm = fn;
    },
    unavailable() {
      available = false;
    },
    dispose() {
      hooks.unmount();
    },
  };
}
test("clear cancellation is inert and rapid repeat uses one operation; failed request retries the same identity", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.cancel();
    f.button("Clear saved chat memories").props.onClick();
    assert.equal(f.requests.length, 0);
  } finally {
    f.dispose();
  }
  const g = fixture();
  try {
    await g.ready();
    const clear = g.button("Clear saved chat memories");
    clear.props.onClick();
    clear.props.onClick();
    assert.equal(g.requests.length, 1);
    g.requests[0].reject(Error("timeout"));
    await tick();
    assert.match(text(g.render()), /Outcome not confirmed/);
    g.button("Retry clear").props.onClick();
    assert.equal(g.requests[0].data.operationId, g.requests[1].data.operationId);
    g.respond(1);
    await tick();
    assert.ok(g.button("Undo clear 1"));
  } finally {
    g.dispose();
  }
});
test("conflict Cancel makes no request; failed Undo remains available and explicit keep-newer sends reviewed token", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.button("Clear saved chat memories").props.onClick();
    f.respond(0);
    await tick();
    f.button("Undo clear 1").props.onClick();
    f.requests[1].reject(Error("offline"));
    await tick();
    assert.ok(f.button("Retry restore"));
    f.button("Retry restore").props.onClick();
    f.respond(2, "conflict", { conflictCount: 1, conflictToken: "a".repeat(32) });
    await tick();
    f.button("Cancel restoration").props.onClick();
    assert.equal(f.requests.length, 3);
    f.button("Undo clear 1").props.onClick();
    f.respond(3, "conflict", { conflictCount: 1, conflictToken: "b".repeat(32) });
    await tick();
    f.button("Keep newer records and restore the rest").props.onClick();
    assert.equal(f.requests[4].data.keepNewer, true);
    assert.equal(f.requests[4].data.conflictToken, "b".repeat(32));
  } finally {
    f.dispose();
  }
});
for (const boundary of ["account", "reset", "unmount"])
  test(`late clear response cannot repopulate recovery after ${boundary}`, async () => {
    const f = fixture();
    try {
      await f.ready();
      f.button("Clear saved chat memories").props.onClick();
      if (boundary === "account") f.setOwner("b");
      else if (boundary === "reset") f.window.dispatchEvent(new Event("reset"));
      else f.dispose();
      f.respond(0);
      await tick();
      assert.equal(f.changes.length, 0);
      if (boundary !== "unmount") assert.doesNotMatch(text(f.render()), /Clear\s+1\s*:/);
    } finally {
      if (boundary !== "unmount") f.dispose();
    }
  });
test("reset during confirmation and stale Undo handler cannot submit prior generation", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.button("Clear saved chat memories").props.onClick();
    f.respond(0);
    await tick();
    const undo = f.button("Undo clear 1");
    f.window.dispatchEvent(new Event("reset"));
    undo.props.onClick();
    assert.equal(f.requests.length, 1);
    f.render();
    f.confirmWith(() => f.window.dispatchEvent(new Event("reset")));
    f.button("Clear saved chat memories").props.onClick();
    assert.equal(f.requests.length, 1);
  } finally {
    f.dispose();
  }
});
test("unconfigured capability cannot send a clear", async () => {
  const f = fixture();
  try {
    f.unavailable();
    await f.ready();
    assert.equal(f.button("Clear saved chat memories").props.disabled, true);
    f.button("Clear saved chat memories").props.onClick();
    assert.equal(f.requests.length, 0);
  } finally {
    f.dispose();
  }
});
