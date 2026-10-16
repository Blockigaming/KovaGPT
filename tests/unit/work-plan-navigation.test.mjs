import test from "node:test";
import assert from "node:assert/strict";
import { createHookHarness, loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
import { controlledHistory } from "../helpers/controlled-browser-history.mjs";
import * as principal from "../../src/lib/principal-browser-storage.mjs";
import * as sessions from "../../src/lib/work-session.mjs";
const draft = loadUiModule("src/lib/work-draft.ts", { "./work-session.mjs": sessions });
function fixture() {
  const hooks = createHookHarness();
  let blocker,
    answer = false,
    failSave = false;
  const rows = [
      sessions.createWorkSession({
        objective: "Plan A",
        context: "Saved context",
        plan: ["First step"],
      }),
      sessions.createWorkSession({ objective: "Plan B", context: "", plan: [] }),
    ],
    writes = [],
    prompts = [],
    errors = [],
    copies = [],
    downloads = [],
    navigations = [],
    handoffs = new Map();
  let rejectNavigation,
    duringConfirm = () => {};
  const storage = {
    getItem: (key) => handoffs.get(key) ?? null,
    setItem: (key, value) => handoffs.set(key, value),
    removeItem: (key) => handoffs.delete(key),
  };
  const browser = controlledHistory("node_modules/@tanstack/history/src/index.ts", ["/work"], 0);
  const window = browser.window;
  browser.history.block({
    blockerFn: () => blocker.shouldBlockFn(),
    enableBeforeUnload: () => blocker.enableBeforeUnload,
  });
  window.confirm = (m) => {
    prompts.push(m);
    duringConfirm();
    return answer;
  };
  window.location.assign = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) {
      prompts.push("Native beforeunload: Stay");
      return;
    }
    throw Error("Unexpected document navigation");
  };
  const { WorkSessionPanel } = loadUiModule(
    "src/components/WorkSessionPanel.tsx",
    {
      "@/lib/work-draft": draft,
      "@/lib/writing-export/common": {
        downloadBytes: (bytes) => downloads.push(new TextDecoder().decode(bytes)),
      },
      react: hooks.react,
      "@tanstack/react-router": {
        useBlocker: (v) => (blocker = v),
        useNavigate: () => (options) => {
          navigations.push(options);
          browser.history.push(options.to, undefined, { ignoreBlocker: options.ignoreBlocker });
          browser.history.flush();
          return new Promise((_resolve, reject) => {
            rejectNavigation = reject;
          });
        },
      },
      sonner: { toast: { error: (e) => errors.push(e), success() {} } },
      "@/hooks/use-work-store-revision": { useWorkStoreRevision() {} },
      "@/lib/work-store": {
        loadWorkSessions: () => rows,
        saveWorkSessions: (_owner, next) => {
          if (failSave) throw Error("Storage unavailable");
          writes.push(next);
          rows.splice(0, rows.length, ...next);
        },
      },
      "@/lib/work-sync-state": { readWorkSyncState: () => null },
      "@/components/WorkExecutionPanel": { WorkExecutionPanel: "WorkExecutionPanel" },
      "@/lib/work-session.mjs": sessions,
      "@/lib/principal-browser-storage.mjs": {
        ...principal,
        isPrincipalBrowserStorageClearedEvent: () => true,
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "clear",
        safeBrowserStorage: () => storage,
      },
    },
    {
      window,
      localStorage: {},
      crypto,
      TextEncoder,
      navigator: { clipboard: { writeText: async (text) => copies.push(text) } },
    },
  );
  const render = () => hooks.render(WorkSessionPanel, { ownerId: "owner-a", prepared: null });
  const button = (label) =>
    elements(render(), (n) => n.type === "button" && text(n).trim() === label)[0];
  const select = (id) =>
    elements(render(), (n) => n.type === "select")[0].props.onChange({ target: { value: id } });
  const input = (i = 0) =>
    elements(render(), (n) => n.type === "input" && n.props.type !== "checkbox")[i];
  const edit = () => {
    select(rows[0].id);
    button("Edit plan").props.onClick();
    input(1).props.onChange({ target: { value: "Unsaved edit" } });
  };
  return {
    render,
    copies,
    downloads,
    button,
    select,
    input,
    edit,
    rows,
    writes,
    prompts,
    errors,
    navigations,
    handoffs,
    storage,
    window,
    rejectNavigation() {
      rejectNavigation(Error("Navigation failed"));
    },
    duringConfirm(fn) {
      duringConfirm = fn;
    },
    get blocker() {
      return blocker;
    },
    allow() {
      answer = true;
    },
    fail() {
      failSave = true;
    },
    dispose() {
      hooks.unmount();
      browser.history.destroy();
    },
  };
}
test("switching saved plans and reloading cannot silently discard edited fields", () => {
  const f = fixture();
  try {
    f.edit();
    f.select(f.rows[1].id);
    assert.equal(f.input(1).props.value, "Unsaved edit");
    f.button("Reload saved version").props.onClick();
    assert.equal(f.input(1).props.value, "Unsaved edit");
    f.button("Cancel edit").props.onClick();
    assert.equal(f.input(1).props.value, "Unsaved edit");
    assert.equal(f.writes.length, 0);
    assert.ok(f.prompts.length >= 3);
  } finally {
    f.dispose();
  }
});
test("navigation and create-session cancel before discarding or mutating", () => {
  const f = fixture();
  try {
    f.edit();
    f.render();
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(f.blocker.shouldBlockFn(), true);
    f.input().props.onChange({ target: { value: "New plan" } });
    elements(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    assert.equal(f.writes.length, 0);
    assert.equal(f.input(1).props.value, "Unsaved edit");
  } finally {
    f.dispose();
  }
});
test("returning to saved fields clears edit dirty state; confirmed discard changes only view", () => {
  const f = fixture();
  try {
    f.edit();
    f.input(1).props.onChange({ target: { value: "Plan A" } });
    f.render();
    assert.equal(f.blocker.enableBeforeUnload, false);
    f.input(1).props.onChange({ target: { value: "Different" } });
    f.allow();
    f.select(f.rows[1].id);
    assert.equal(f.input(1), undefined);
    assert.equal(f.writes.length, 0);
    assert.equal(f.rows[0].objective, "Plan A");
  } finally {
    f.dispose();
  }
});
test("save failure preserves edited fields and navigation protection", () => {
  const f = fixture();
  try {
    f.edit();
    f.fail();
    elements(f.render(), (n) => n.type === "form")[1].props.onSubmit({ preventDefault() {} });
    assert.equal(f.input(1).props.value, "Unsaved edit");
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(f.rows[0].objective, "Plan A");
    assert.equal(f.errors.length, 1);
  } finally {
    f.dispose();
  }
});

test("chat cancellation leaves no handoff; acceptance uses one client navigation decision", () => {
  const f = fixture();
  try {
    f.select(f.rows[0].id);
    f.input().props.onChange({ target: { value: "Unsaved objective" } });
    f.button("Continue in chat").props.onClick();
    assert.equal(f.handoffs.size, 0);
    assert.equal(f.navigations.length, 0);
    f.allow();
    f.prompts.length = 0;
    f.button("Continue in chat").props.onClick();
    assert.equal(f.prompts.length, 1);
    assert.equal(f.errors.length, 0);
    assert.equal(f.navigations.length, 1);
    assert.equal(f.navigations[0].to, "/");
    assert.equal(f.navigations[0].ignoreBlocker, true);
    assert.equal(f.handoffs.size, 1);
    assert.equal(f.blocker.enableBeforeUnload, true);
    const [key, value] = [...f.handoffs][0];
    assert.equal(key, principal.principalScopedStorageKey("kova-app-chat-context", "owner-a"));
    assert.match(value, /Plan A/);
  } finally {
    f.dispose();
  }
});
for (const newer of [false, true])
  test(`failed client navigation removes only owned handoff (newer=${newer})`, async () => {
    const f = fixture();
    try {
      f.select(f.rows[0].id);
      f.allow();
      f.button("Continue in chat").props.onClick();
      const key = [...f.handoffs.keys()][0];
      const otherKey = principal.principalScopedStorageKey("kova-app-chat-context", "owner-b");
      f.handoffs.set(otherKey, "other account handoff");
      if (newer) f.handoffs.set(key, "newer handoff");
      f.rejectNavigation();
      await Promise.resolve();
      assert.equal(f.handoffs.get(key), newer ? "newer handoff" : undefined);
      assert.equal(f.handoffs.get(otherKey), "other account handoff");
    } finally {
      f.dispose();
    }
  });
test("privacy reset during confirmation cannot create an old account handoff", () => {
  const f = fixture();
  try {
    f.select(f.rows[0].id);
    f.input().props.onChange({ target: { value: "Unsaved" } });
    f.allow();
    f.duringConfirm(() => f.window.dispatchEvent(new Event("clear")));
    f.button("Continue in chat").props.onClick();
    assert.equal(f.handoffs.size, 0);
    assert.equal(f.navigations.length, 0);
  } finally {
    f.dispose();
  }
});
test("plan changed during confirmation cannot send a stale target", () => {
  const f = fixture();
  try {
    f.select(f.rows[0].id);
    f.input().props.onChange({ target: { value: "Unsaved" } });
    f.allow();
    f.duringConfirm(() => {
      f.rows[0] = { ...f.rows[0], objective: "Updated elsewhere" };
    });
    f.button("Continue in chat").props.onClick();
    assert.equal(f.handoffs.size, 0);
    assert.equal(f.navigations.length, 0);
  } finally {
    f.dispose();
  }
});

for (const method of ["getItem", "removeItem"]) {
  test(`navigation rejection reports unverified cleanup when ${method} throws`, async () => {
    const f = fixture();
    try {
      f.select(f.rows[0].id);
      f.allow();
      f.button("Continue in chat").props.onClick();
      const owned = [...f.handoffs.entries()][0];
      const otherKey = principal.principalScopedStorageKey("kova-app-chat-context", "owner-b");
      f.handoffs.set(otherKey, "other account handoff");
      f.storage[method] = () => {
        throw new Error("Storage unavailable");
      };
      f.rejectNavigation();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.errors.length, 1);
      assert.match(f.errors[0], /could not be opened in chat/);
      assert.match(f.errors[0], /cleanup could not be verified/i);
      assert.match(f.errors[0], /may still be available/i);
      assert.equal(f.handoffs.get(owned[0]), owned[1]);
      assert.equal(f.handoffs.get(otherKey), "other account handoff");
    } finally {
      f.dispose();
    }
  });
}

test("draft rescue copies/downloads current fields without saving or clearing dirty state", async () => {
  const f = fixture();
  try {
    f.edit();
    f.button("Copy draft").props.onClick();
    await Promise.resolve();
    f.button("Download draft").props.onClick();
    assert.equal(JSON.parse(f.copies[0]).objective, "Unsaved edit");
    assert.equal(f.copies[0], f.downloads[0]);
    assert.equal(f.writes.length, 0);
    assert.equal(f.blocker.enableBeforeUnload, true);
  } finally {
    f.dispose();
  }
});
test("draft duplication is confirmed, keeps current edits and original, and creates no execution", () => {
  const f = fixture();
  try {
    f.edit();
    const original = JSON.stringify(f.rows);
    f.button("Duplicate current draft").props.onClick();
    assert.equal(JSON.stringify(f.rows), original);
    f.allow();
    f.button("Duplicate current draft").props.onClick();
    assert.equal(f.rows.length, 3);
    assert.equal(f.rows[0].objective, "Unsaved edit");
    assert.equal(f.rows[0].parent, null);
    assert.equal(JSON.stringify(f.rows.slice(1)), original);
    assert.equal(f.input(1).props.value, "Unsaved edit");
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(elements(f.render(), (n) => n.type === "WorkExecutionPanel").length, 0);
  } finally {
    f.dispose();
  }
});
for (const failure of ["storage", "reset"])
  test(`duplicate ${failure} preserves originals without a partial record`, () => {
    const f = fixture();
    try {
      f.edit();
      const original = JSON.stringify(f.rows);
      f.allow();
      if (failure === "storage") f.fail();
      else f.duringConfirm(() => f.window.dispatchEvent(new Event("clear")));
      f.button("Duplicate current draft").props.onClick();
      assert.equal(JSON.stringify(f.rows), original);
      assert.equal(f.writes.length, 0);
      assert.equal(f.errors.length, 1);
    } finally {
      f.dispose();
    }
  });

test("duplicate confirmation preserves a newer original revision and unrelated additions", () => {
  const f = fixture();
  try {
    f.edit();
    const originalId = f.rows[0].id;
    let newer, added;
    f.allow();
    f.duringConfirm(() => {
      newer = {
        ...f.rows[0],
        objective: "Newer synced original",
        context: "New remote context",
        updatedAt: Date.now() + 1,
      };
      added = sessions.createWorkSession({
        objective: "Added during confirmation",
        context: "",
        plan: [],
      });
      f.rows.splice(0, 1, newer);
      f.rows.push(added);
    });
    f.button("Duplicate current draft").props.onClick();
    assert.deepEqual(
      f.rows.find((row) => row.id === originalId),
      newer,
    );
    assert.deepEqual(
      f.rows.find((row) => row.id === added.id),
      added,
    );
    assert.equal(f.rows[0].objective, "Unsaved edit");
    assert.notEqual(f.rows[0].id, originalId);
    assert.equal(f.input(1).props.value, "Unsaved edit");
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(f.writes.length, 1);
    assert.equal(elements(f.render(), (n) => n.type === "WorkExecutionPanel").length, 0);
  } finally {
    f.dispose();
  }
});

test("draft serializer excludes enriched editing metadata and preserves incomplete typed bytes", () => {
  const current = {
    objective: "  \t",
    context: " current\r\ncontext \n",
    plan: " first\n\n unfinished ",
  };
  const enriched = {
    ...current,
    format: "unexpected-runtime-format",
    id: "saved-id",
    base: { objective: "Stale objective", history: ["Saved history"] },
    history: ["unrelated"],
  };
  const before = JSON.stringify(enriched);
  const bytes = draft.serializeWorkDraft(enriched);
  assert.deepEqual(JSON.parse(bytes), { format: "kova-work-draft-v1", ...current });
  assert.equal(bytes, JSON.stringify({ format: "kova-work-draft-v1", ...current }, null, 2) + "\n");
  assert.equal(JSON.stringify(enriched), before);
});

test("Copy and Download rescue only current editing fields, excluding stale saved base/history", async () => {
  const f = fixture();
  try {
    f.rows[0].history = [{ label: "Stale saved history" }];
    const original = JSON.stringify(f.rows);
    f.edit();
    const current = {
      objective: " \tunfinished objective ",
      context: "current context\n\n",
      plan: " first\n  incomplete \n",
    };
    f.input(1).props.onChange({ target: { value: current.objective } });
    elements(f.render(), (node) => node.type === "textarea")[0].props.onChange({
      target: { value: current.context },
    });
    elements(f.render(), (node) => node.type === "textarea")[1].props.onChange({
      target: { value: current.plan },
    });
    f.button("Copy draft").props.onClick();
    await Promise.resolve();
    f.button("Download draft").props.onClick();
    const expected = JSON.stringify({ format: "kova-work-draft-v1", ...current }, null, 2) + "\n";
    assert.equal(f.copies[0], expected);
    assert.equal(f.downloads[0], expected);
    assert.equal(JSON.stringify(f.rows), original);
    assert.equal(f.writes.length, 0);
    assert.equal(f.input(1).props.value, current.objective);
    assert.equal(f.blocker.enableBeforeUnload, true);
    assert.equal(elements(f.render(), (n) => n.type === "WorkExecutionPanel").length, 0);
  } finally {
    f.dispose();
  }
});
