import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const serverSource = readFileSync("src/lib/project-workspace.functions.ts", "utf8");
const routeSource = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const component = routeSource.slice(
  routeSource.indexOf("function TasksTab("),
  routeSource.indexOf("// ===================== MEMORY"),
);
function compile(source, dependencies) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}
const middleware = Symbol("authenticated RLS client");
const reorder = compile(
  serverSource
    .slice(
      serverSource.indexOf("export const reorderTasks ="),
      serverSource.indexOf("export const deleteTask ="),
    )
    .replace("export const", "const") + "\nreturn reorderTasks;",
  {
    z,
    requireSupabaseAuth: middleware,
    createServerFn: () => ({
      middleware(value) {
        assert.deepEqual(value, [middleware]);
        return this;
      },
      validator(value) {
        this.validate = value;
        return this;
      },
      handler(value) {
        return { validate: this.validate, run: value };
      },
    }),
  },
);
const ids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];
const projectId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function serverFixture(respond = (call) => ({ data: { id: call.filters.id }, error: null })) {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, filters: {} };
      return {
        update(patch) {
          call.patch = patch;
          return this;
        },
        eq(key, value) {
          call.filters[key] = value;
          return this;
        },
        select(columns) {
          call.columns = columns;
          return this;
        },
        async maybeSingle() {
          calls.push(call);
          return respond(call, calls.length);
        },
      };
    },
  };
  return {
    calls,
    run: (order = ids) =>
      reorder.run({
        data: reorder.validate({ project_id: projectId, order }),
        context: { supabase },
      }),
  };
}

test("reorder authenticates, retains the project filter, confirms each row, and writes sequentially", async () => {
  const first = deferred();
  const f = serverFixture((call, index) =>
    index === 1 ? first.promise : { data: { id: call.filters.id }, error: null },
  );
  const pending = f.run();
  assert.equal(f.calls.length, 1);
  first.resolve({ data: { id: ids[0] }, error: null });
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(
    f.calls,
    ids.map((id, index) => ({
      table: "project_tasks",
      filters: { id, project_id: projectId },
      patch: { position: index + 1 },
      columns: "id",
    })),
  );
});

for (const failureIndex of [1, 2]) {
  for (const failure of ["database", "no row", "transport"]) {
    test(`reorder stops remaining writes after ${failure} failure at row ${failureIndex}`, async () => {
      const f = serverFixture((call, index) => {
        if (index !== failureIndex) return { data: { id: call.filters.id }, error: null };
        if (failure === "transport") throw new Error("connection lost");
        return failure === "database"
          ? { data: null, error: { message: "update denied" } }
          : { data: null, error: null };
      });
      await assert.rejects(f.run(), /update denied|connection lost|could not be updated/);
      assert.equal(
        f.calls.length,
        failureIndex,
        "earlier successful writes remain possible; later rows are untouched",
      );
    });
  }
}

test("reorder rejects duplicate IDs, including differently cased UUIDs, before any write", () => {
  for (const order of [
    [ids[0], ids[0]],
    [ids[0], ids[0].toUpperCase()],
  ]) {
    const f = serverFixture();
    assert.throws(() => f.run(order), /duplicate IDs/);
    assert.equal(f.calls.length, 0);
  }
});

test("reorder retains UUID and size validation and supports an empty order", async () => {
  const f = serverFixture();
  for (const order of [["invalid"], Array(501).fill(ids[0])]) assert.throws(() => f.run(order));
  assert.deepEqual(await f.run([]), { ok: true });
  assert.equal(f.calls.length, 0);
});

function tasks(order = ["a", "b", "c"]) {
  return order.map((id, index) => ({
    id,
    title: `Task ${id}`,
    status: "todo",
    position: index + 1,
    due_date: null,
  }));
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const slots = [],
    focused = [],
    focusOptions = [],
    focusState = { active: null },
    region = {
      focus: (options) => {
        focused.push("project-tasks");
        focusOptions.push(options);
        focusState.active = "project-tasks";
      },
    },
    effects = [],
    errors = [],
    writes = [];
  const requests = { list: [], reorder: [], create: [], update: [], delete: [] };
  let cursor = 0,
    dirty = false,
    tree,
    alive = true;
  const props = { projectId: "project-a", canEdit: true };
  const auth = { isSignedIn: true, user: { id: "owner-a" } };
  const request = (name) => (args) => {
    const pending = deferred();
    requests[name].push({ ...pending, args });
    return pending.promise;
  };
  function memo(factory, dependencies) {
    const index = cursor++,
      previous = slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      slots[index] = { dependencies, value: factory() };
    }
    return slots[index].value;
  }
  const renderComponent = compile(`${component}\nreturn TasksTab;`, {
    React: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    },
    useUser: () => auth,
    useServerFn: (fn) => fn,
    listTasks: request("list"),
    createTask: request("create"),
    updateTask: request("update"),
    deleteTask: request("delete"),
    reorderTasks: request("reorder"),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          writes.push({ alive, index });
          const next = typeof value === "function" ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) dirty = true;
          slots[index] = next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useEffect(callback, dependencies) {
      const index = cursor++,
        previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
      ) {
        const entry = { dependencies, callback };
        slots[index] = entry;
        effects.push(() => {
          previous?.cleanup?.();
          entry.cleanup = callback();
        });
      }
    },
    toast: { error: (value) => errors.push(value) },
    ...Object.fromEntries(
      [
        "Loader2",
        "Input",
        "Button",
        "Plus",
        "EmptyState",
        "CheckSquare",
        "GripVertical",
        "ArrowUp",
        "ArrowDown",
        "Calendar",
        "Trash2",
        "ConfirmDialog",
      ].map((name) => [name, name]),
    ),
  });
  function render() {
    for (let count = 0; count < 10; count++) {
      cursor = 0;
      dirty = false;
      tree = renderComponent(props);
      if (tree.props.ref) tree.props.ref.current = region;
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return tree;
    }
    throw new Error("Hooks did not settle");
  }
  function findAll(predicate, node = tree) {
    if (Array.isArray(node)) return node.flatMap((child) => findAll(predicate, child));
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...findAll(predicate, node.children)];
  }
  function text(node = tree) {
    if (Array.isArray(node)) return node.map(text).join(" ");
    if (node == null || typeof node === "boolean") return "";
    return typeof node === "object" ? text(node.children) : String(node);
  }
  const rows = () => findAll((node) => typeof node.props.onDrop === "function");
  const row = (id) => rows().find((node) => node.props.key === id);
  const drag = (from, to) => {
    row(from).props.onDragStart();
    return row(to).props.onDrop();
  };
  async function finishList(index = requests.list.length - 1, data = tasks()) {
    requests.list[index].resolve(data);
    await tick();
    render();
  }
  render();
  return {
    props,
    auth,
    focused,
    focusOptions,
    focusElsewhere() {
      focusState.active = "later user control";
    },
    activeFocus: () => focusState.active,
    requests,
    errors,
    writes,
    render,
    findAll,
    text,
    rows,
    row,
    drag,
    finishList,
    order: () => rows().map((node) => node.props.key),
    retry: () =>
      findAll(
        (node) => node.type === "Button" && text(node).includes("Retry loading tasks"),
      )[0].props.onClick(),
    unmount() {
      alive = false;
      slots.forEach((slot) => slot?.cleanup?.());
    },
    restartEffects() {
      slots.forEach((slot) => {
        if (slot?.callback) {
          slot.cleanup?.();
          slot.cleanup = slot.callback();
        }
      });
      render();
    },
  };
}

test("task order succeeds optimistically and blocks repeated drops and other mutations before rerender", async () => {
  const f = fixture();
  await f.finishList();
  const pending = f.drag("c", "a");
  await f.drag("b", "a");
  await f.findAll((node) => node.props["aria-label"] === "Cycle status")[0].props.onClick();
  assert.equal(f.requests.reorder.length, 1);
  assert.equal(f.requests.update.length, 0);
  assert.deepEqual(f.requests.reorder[0].args, {
    data: { project_id: "project-a", order: ["c", "a", "b"] },
  });
  f.render();
  assert.deepEqual(f.order(), ["c", "a", "b"]);
  assert.ok(f.rows().every((node) => node.props.draggable === false));
  f.requests.reorder[0].resolve({ ok: true });
  await pending;
  f.render();
  assert.deepEqual(f.order(), ["c", "a", "b"]);
  assert.equal(f.requests.list.length, 1);
  assert.equal(f.errors.length, 0);
  assert.ok(f.rows().every((node) => node.props.draggable === true));
});

test("failed or partially saved reorder reloads the authoritative order while retaining readable tasks", async () => {
  const f = fixture();
  await f.finishList();
  const pending = f.drag("c", "a");
  f.requests.reorder[0].reject(new Error("row 2 failed"));
  await tick();
  f.render();
  assert.deepEqual(f.order(), ["a", "b", "c"]);
  assert.match(f.text(), /Couldn't confirm the task order.*Some changes may have been saved/);
  assert.equal(f.requests.list.length, 2);
  await f.drag("b", "a");
  assert.equal(f.requests.reorder.length, 1);
  await f.finishList(1, tasks(["b", "c", "a"]));
  await pending;
  f.render();
  assert.deepEqual(f.order(), ["b", "c", "a"]);
  assert.match(f.text(), /Showing the latest saved tasks/);
  assert.equal(f.errors.length, 1);
});

test("failed recovery reload preserves prior tasks, blocks reorder, and offers Retry", async () => {
  const f = fixture();
  await f.finishList();
  const pending = f.drag("c", "a");
  f.requests.reorder[0].reject(new Error("offline"));
  await tick();
  f.requests.list[1].reject(new Error("offline"));
  await pending;
  f.render();
  assert.deepEqual(f.order(), ["a", "b", "c"]);
  assert.match(f.text(), /previously loaded tasks are still shown; their order may be out of date/);
  await f.drag("b", "a");
  assert.equal(f.requests.reorder.length, 1);
  f.retry();
  f.render();
  assert.deepEqual(f.order(), ["a", "b", "c"]);
  await f.finishList(2, tasks(["c", "b", "a"]));
  assert.deepEqual(f.order(), ["c", "b", "a"]);
  assert.match(f.text(), /Showing the latest saved tasks/);
  assert.doesNotMatch(f.text(), /Couldn't refresh tasks/);
});

test("initial load failure is an error with Retry, never an empty-success state", async () => {
  const f = fixture();
  f.requests.list[0].reject(new Error("offline"));
  await tick();
  f.render();
  assert.match(f.text(), /Couldn't load tasks/);
  assert.equal(f.findAll((node) => node.type === "EmptyState").length, 0);
  f.retry();
  await f.finishList(1, []);
  assert.equal(f.findAll((node) => node.type === "EmptyState").length, 1);
});

test("initial loading ignores stale project, account, sign-out, and unmount results", async () => {
  for (const boundary of ["project", "account", "sign-out", "unmount"]) {
    for (const failure of [false, true]) {
      const f = fixture();
      if (boundary === "project") {
        f.props.projectId = "project-b";
        f.render();
      }
      if (boundary === "account") {
        f.auth.user = { id: "owner-b" };
        f.render();
      }
      if (boundary === "sign-out") {
        f.auth.isSignedIn = false;
        f.auth.user = null;
        f.render();
      }
      if (boundary === "unmount") f.unmount();
      const writes = f.writes.length;
      if (failure) f.requests.list[0].reject(new Error("obsolete load"));
      else f.requests.list[0].resolve(tasks(["obsolete"]));
      await tick();
      assert.equal(f.writes.length, writes);
      assert.equal(f.errors.length, 0);
    }
  }
});

test("viewer, same-row, and cancelled drags never write a task order", async () => {
  const f = fixture();
  await f.finishList();
  await f.drag("a", "a");
  f.row("a").props.onDragStart();
  f.row("a").props.onDragEnd();
  await f.row("b").props.onDrop();
  f.props.canEdit = false;
  f.render();
  await f.drag("c", "a");
  assert.equal(f.requests.reorder.length, 0);
  assert.deepEqual(f.order(), ["a", "b", "c"]);
});

test("newer reload wins over an older success or failure", async () => {
  for (const staleFailure of [false, true]) {
    const f = fixture();
    f.requests.list[0].reject(new Error("offline"));
    await tick();
    f.render();
    const retry = f.findAll(
      (node) => node.type === "Button" && f.text(node).includes("Retry loading tasks"),
    )[0].props.onClick;
    retry();
    retry();
    await f.finishList(2, tasks(["c", "a"]));
    const writes = f.writes.length;
    if (staleFailure) f.requests.list[1].reject(new Error("stale failure"));
    else f.requests.list[1].resolve(tasks());
    await tick();
    f.render();
    assert.equal(f.writes.length, writes);
    assert.deepEqual(f.order(), ["c", "a"]);
    assert.doesNotMatch(f.text(), /Couldn't/);
  }
});

for (const boundary of ["project", "account", "unmount", "effect restart"]) {
  for (const failure of [false, true]) {
    test(`reorder ${failure ? "failure" : "success"} after ${boundary} cannot update the new view`, async () => {
      const f = fixture();
      await f.finishList();
      const pending = f.drag("c", "a");
      if (boundary === "project") {
        f.props.projectId = "project-b";
        f.render();
      }
      if (boundary === "account") {
        f.auth.user = { id: "owner-b" };
        f.render();
      }
      if (boundary === "unmount") f.unmount();
      if (boundary === "effect restart") f.restartEffects();
      const writes = f.writes.length,
        requests = f.requests.list.length;
      if (failure) f.requests.reorder[0].reject(new Error("obsolete failure"));
      else f.requests.reorder[0].resolve({ ok: true });
      await pending;
      assert.equal(f.writes.length, writes);
      assert.equal(f.requests.list.length, requests);
      assert.equal(f.errors.length, 0);
      assert.equal(f.writes.filter((write) => !write.alive).length, 0);
      if (boundary !== "unmount") {
        await f.finishList(undefined, tasks(["new"]));
        assert.deepEqual(f.order(), ["new"]);
      }
    });
  }
}

test("reconciliation already in flight cannot refill a switched account, project, or unmounted view", async () => {
  for (const boundary of ["account", "project", "unmount"]) {
    const f = fixture();
    await f.finishList();
    const pending = f.drag("c", "a");
    f.requests.reorder[0].reject(new Error("partial failure"));
    await tick();
    if (boundary === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    }
    if (boundary === "project") {
      f.props.projectId = "project-b";
      f.render();
    }
    if (boundary === "unmount") f.unmount();
    const writes = f.writes.length;
    f.requests.list[1].resolve(tasks(["obsolete"]));
    await pending;
    assert.equal(f.writes.length, writes);
  }
});

for (const action of ["update", "delete", "create"]) {
  function startMutation(f) {
    if (action === "update")
      return f.findAll((node) => node.props["aria-label"] === "Cycle status")[0].props.onClick();
    if (action === "delete") {
      f.findAll((node) => node.props["aria-label"] === "Delete task")[0].props.onClick();
      f.render();
      return f.findAll((node) => node.type === "ConfirmDialog")[0].props.onConfirm();
    }
    f.findAll(
      (node) => node.type === "Input" && node.props.placeholder === "New task…",
    )[0].props.onChange({ target: { value: "Draft task" } });
    f.render();
    return f
      .findAll((node) => node.type === "Input" && node.props.placeholder === "New task…")[0]
      .props.onKeyDown({ key: "Enter" });
  }
  test(`${action} failure is handled, retains prior tasks on reload failure, and stays retryable`, async () => {
    const f = fixture();
    await f.finishList();
    const pending = startMutation(f);
    await startMutation(f);
    assert.equal(f.requests[action].length, 1);
    await f.drag("c", "a");
    assert.equal(f.requests.reorder.length, 0);
    f.requests[action][0].reject(new Error("mutation failed"));
    await tick();
    f.requests.list[1].reject(new Error("reload failed"));
    await pending;
    f.render();
    assert.equal(f.errors.length, 1);
    assert.match(f.text(), /Couldn't confirm/);
    assert.deepEqual(f.order(), ["a", "b", "c"]);
    if (action === "delete")
      assert.equal(f.findAll((node) => node.type === "ConfirmDialog")[0].props.open, true);
    if (action === "create")
      assert.equal(
        f.findAll((node) => node.type === "Input" && node.props.placeholder === "New task…")[0]
          .props.value,
        "Draft task",
      );
    f.retry();
    await f.finishList(2);
    assert.ok(f.rows().every((node) => node.props.draggable));
  });
  test(`${action} success refreshes rows, and stale success/failure never changes another account`, async () => {
    for (const outcome of ["current success", "stale success", "stale failure"]) {
      const f = fixture();
      await f.finishList();
      const pending = startMutation(f);
      if (outcome !== "current success") {
        f.auth.user = { id: "owner-b" };
        f.render();
      }
      const writes = f.writes.length,
        loads = f.requests.list.length;
      if (outcome === "stale failure") f.requests[action][0].reject(new Error("obsolete"));
      else f.requests[action][0].resolve({ ok: true });
      await tick();
      if (outcome === "current success") {
        assert.equal(f.requests.list.length, loads + 1);
        await f.finishList(undefined, tasks(["saved"]));
        await pending;
        f.render();
        assert.deepEqual(f.order(), ["saved"]);
        if (action === "delete")
          assert.equal(f.findAll((node) => node.type === "ConfirmDialog")[0].props.open, false);
        if (action === "create")
          assert.equal(
            f.findAll((node) => node.type === "Input" && node.props.placeholder === "New task…")[0]
              .props.value,
            "",
          );
      } else {
        await pending;
        assert.equal(f.requests.list.length, loads);
        assert.equal(f.writes.length, writes);
        assert.equal(f.errors.length, 0);
      }
    }
  });
}

test("explicit task Retry focuses its stable region once, without completion focus theft", async () => {
  const f = fixture();
  assert.deepEqual(f.focused, []);
  f.requests.list[0].reject(new Error("offline"));
  await tick();
  f.render();
  const rootBefore = f.findAll((node) => node.props["data-project-tasks-region"] !== undefined)[0];
  f.retry();
  f.render();
  const loadingRoot = f.findAll((node) => node.props["data-project-tasks-region"] !== undefined)[0];
  assert.equal(rootBefore.type, "div");
  assert.equal(loadingRoot.type, "div");
  assert.equal(loadingRoot.props.ref, rootBefore.props.ref);
  assert.equal(loadingRoot.props.tabIndex, -1);
  assert.deepEqual(f.focused, ["project-tasks"]);
  await f.finishList(1);
  assert.deepEqual(f.focused, ["project-tasks"], "completion never moves later user focus");
});

test("status mutation keeps focus on a stable region across failed and successful regrouping", async () => {
  const f = fixture();
  await f.finishList();
  const action = f
    .findAll((node) => node.props["aria-label"] === "Cycle status")[0]
    .props.onClick();
  assert.deepEqual(f.focused, ["project-tasks"]);
  f.requests.update[0].reject(new Error("offline"));
  await tick();
  await f.finishList(1);
  await action;
  assert.deepEqual(f.focused, ["project-tasks"]);
  f.render();
  const retry = f.findAll((node) => node.props["aria-label"] === "Cycle status")[0].props.onClick();
  f.requests.update[1].resolve({ ok: true });
  await tick();
  await f.finishList(
    2,
    tasks().map((t) => (t.id === "a" ? { ...t, status: "doing" } : t)),
  );
  await retry;
  assert.deepEqual(
    f.focused,
    ["project-tasks", "project-tasks"],
    "only intentional invocations move focus",
  );
});

test("task deletion names its target, keeps failure in the dialog, and returns focus safely", async () => {
  const f = fixture();
  await f.finishList();
  let invokerFocus = 0;
  const invoker = {
    isConnected: true,
    disabled: false,
    focus() {
      invokerFocus++;
    },
  };
  f.findAll((node) => node.props["aria-label"] === "Delete task")[0].props.onClick({
    currentTarget: invoker,
  });
  f.render();
  let dialog = f.findAll((node) => node.type === "ConfirmDialog")[0];
  assert.match(dialog.props.title, /Task a/);
  dialog.props.onOpenChange(false);
  f.render();
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(invokerFocus, 1);
  f.findAll((node) => node.props["aria-label"] === "Delete task")[0].props.onClick({
    currentTarget: invoker,
  });
  f.render();
  dialog = f.findAll((node) => node.type === "ConfirmDialog")[0];
  const pending = dialog.props.onConfirm();
  f.requests.delete[0].reject(new Error("offline"));
  await tick();
  await f.finishList(1);
  await pending;
  dialog = f.findAll((node) => node.type === "ConfirmDialog")[0];
  assert.equal(dialog.props.open, true);
  assert.match(dialog.props.error, /Couldn't confirm that the task was deleted/);
  const retry = dialog.props.onConfirm();
  f.requests.delete[1].resolve({ ok: true });
  await tick();
  await f.finishList(2, tasks(["b", "c"]));
  await retry;
  invoker.isConnected = false;
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.focused, ["project-tasks"]);
});

test("44px non-drag task controls use the same guarded reorder and reconciliation", async () => {
  const f = fixture();
  await f.finishList();
  const up = () => f.findAll((node) => node.props["aria-label"] === "Move Task b up")[0];
  assert.match(up().props.className, /h-11 w-11/);
  assert.equal(
    f.findAll((node) => node.props["aria-label"] === "Move Task a up")[0].props.disabled,
    true,
  );
  assert.equal(
    f.findAll((node) => node.props["aria-label"] === "Move Task c down")[0].props.disabled,
    true,
  );
  up().props.onClick();
  up().props.onClick();
  assert.equal(f.requests.reorder.length, 1);
  assert.deepEqual(f.requests.reorder[0].args.data.order, ["b", "a", "c"]);
  f.render();
  assert.equal(up().props.disabled, true);
  f.requests.reorder[0].reject(new Error("partial write"));
  await tick();
  await f.finishList(1, tasks(["c", "a", "b"]));
  await tick();
  f.render();
  assert.deepEqual(f.order(), ["c", "a", "b"]);
  assert.match(f.text(), /Showing the latest saved tasks/);
  f.props.canEdit = false;
  f.render();
  assert.equal(
    f.findAll((node) => String(node.props["aria-label"]).startsWith("Move Task")).length,
    0,
  );
});

test("task pointer movement is bounded within its displayed status group", async () => {
  const f = fixture();
  await f.finishList(
    0,
    tasks().map((row) => (row.id === "b" ? { ...row, status: "done" } : row)),
  );
  const move = f.findAll((node) => node.props["aria-label"] === "Move Task a down")[0];
  move.props.onClick();
  assert.deepEqual(f.requests.reorder[0].args.data.order, ["b", "c", "a"]);
  f.requests.reorder[0].resolve({ ok: true });
  await tick();
  f.render();
  assert.deepEqual(f.order(), ["c", "a", "b"]);
});

for (const direction of ["up", "down"]) {
  test(`explicit task ${direction} focuses the stable region before disabling, through partial failure and later success`, async () => {
    const f = fixture();
    await f.finishList();
    const root = () =>
      f.findAll((node) => node.props["data-project-tasks-region"] !== undefined)[0];
    const regionRef = root().props.ref;
    const move = () =>
      f
        .findAll((node) => node.props["aria-label"] === `Move Task b ${direction}`)[0]
        .props.onClick();
    move();
    move();
    assert.equal(f.requests.reorder.length, 1);
    assert.deepEqual(f.focused, ["project-tasks"]);
    assert.deepEqual(f.focusOptions, [{ preventScroll: true }]);
    assert.equal(f.activeFocus(), "project-tasks");
    f.render();
    f.focusElsewhere();
    f.requests.reorder[0].reject(new Error("partial saved order"));
    await tick();
    f.render();
    assert.equal(root().props.ref, regionRef);
    assert.equal(root().props.tabIndex, -1);
    await f.finishList(1);
    await tick();
    f.render();
    assert.equal(f.activeFocus(), "later user control");
    assert.deepEqual(f.focused, ["project-tasks"]);
    assert.match(f.text(), /Showing the latest saved tasks/);
    move();
    assert.deepEqual(f.focused, ["project-tasks", "project-tasks"]);
    f.focusElsewhere();
    f.requests.reorder[1].resolve({ ok: true });
    await tick();
    f.render();
    assert.equal(root().props.ref, regionRef);
    assert.equal(f.activeFocus(), "later user control");
    assert.equal(f.focused.length, 2);
  });
}

for (const result of ["success", "failure"]) {
  test(`drag reorder ${result} does not use the pointer-only focus handoff`, async () => {
    const f = fixture();
    await f.finishList();
    f.focusElsewhere();
    const pending = f.drag("c", "a");
    if (result === "success") f.requests.reorder[0].resolve({ ok: true });
    else {
      f.requests.reorder[0].reject(new Error("partial reorder"));
      await tick();
      await f.finishList(1);
    }
    await pending;
    f.render();
    assert.deepEqual(f.focused, []);
    assert.equal(f.activeFocus(), "later user control");
  });
}

for (const boundary of ["account", "project", "sign-out", "unmount"]) {
  test(`stale explicit reorder after ${boundary} cannot request focus or persist`, async () => {
    const f = fixture();
    await f.finishList();
    const oldMove = f.findAll((node) => node.props["aria-label"] === "Move Task b up")[0].props
      .onClick;
    if (boundary === "account") f.auth.user = { id: "owner-b" };
    if (boundary === "project") f.props.projectId = "project-b";
    if (boundary === "sign-out") f.auth.isSignedIn = false;
    if (boundary === "unmount") f.unmount();
    else f.render();
    oldMove();
    assert.equal(f.requests.reorder.length, 0);
    assert.deepEqual(f.focused, []);
  });
}
