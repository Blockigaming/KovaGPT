import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { deferred, elements, settle, text } from "../helpers/ui-state-harness.mjs";

// Source-component event tests only: no browser, provider, database, or live requests.
const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const parsed = ts.createSourceFile(
  "project.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function componentSource(name) {
  return parsed.statements
    .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
    .getText(parsed);
}
function compile(name, dependencies) {
  const component = componentSource(name);
  const tags = Object.fromEntries(
    [...component.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((match) => [match[1], match[1]]),
  );
  const scope = { ...tags, ...dependencies };
  const code = ts.transpileModule(`${component}\nreturn ${name};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}
function fixture(kind = "memory") {
  const slots = [],
    effects = [],
    requests = {},
    writes = [],
    focused = [],
    dom = new Map();
  const auth = { isSignedIn: true, isLoaded: true, user: { id: "account-a" } };
  const props = { projectId: "project-a", canEdit: true };
  const document = { activeElement: null };
  let cursor = 0,
    dirty = false,
    alive = true,
    tree;
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
  }
  const element = (name) => {
    if (!dom.has(name)) dom.set(name, new Element(name));
    return dom.get(name);
  };
  document.activeElement = element("original-trigger");
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
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
      return (slots[index] ??= { current: initial });
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) {
      const index = cursor++,
        previous = slots[index];
      if (!same(previous?.deps, deps)) {
        const entry = { deps, callback };
        slots[index] = entry;
        effects.push(() => {
          previous?.cleanup?.();
          entry.cleanup = callback();
        });
      }
    },
  };
  const request = (name) => (args) => {
    const pending = deferred();
    (requests[name] ??= []).push({ ...pending, args });
    return pending.promise;
  };
  const member = { user_id: "member-a", email: "member@example.invalid", role: "editor" };
  const invite = {
    id: "invite-a",
    email: "invite@example.invalid",
    role: "viewer",
    status: "pending",
  };
  const services = {
    listMemory: request("list"),
    addMemory: request("add"),
    deleteMemory: request("delete"),
    removeMember: request("remove"),
    revokeInvite: request("revoke"),
    getProject: async () => ({
      id: props.projectId,
      name: "Project",
      role: "owner",
      archived_at: null,
    }),
    listMembers: async () => [
      { user_id: "owner", email: "owner@example.invalid", role: "owner" },
      member,
    ],
    listInvites: async () => [invite],
    listProjectChats: async () => [],
    createProjectChat() {},
    updateProject() {},
    deleteProject() {},
    setProjectArchived() {},
    leaveProject() {},
  };
  const renderComponent = compile(kind === "memory" ? "MemoryTab" : "ProjectDetailPage", {
    React: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    },
    ...hooks,
    ...services,
    useUser: () => auth,
    useServerFn: (fn) => fn,
    Route: { useParams: () => ({ projectId: props.projectId }) },
    useNavigate: () => async () => {},
    // This harness executes member/memory recovery only; the actual Move focus
    // hook and its page-refresh lifetime have their own runtime coverage.
    useProjectChatMoveFocus: () => () => {
      throw new Error("Unexpected chat Move in member recovery fixture");
    },
    callServerFnDirect: (fn, args) => fn(args),
    require: (name) => {
      assert.equal(name, "@/lib/projects.functions");
      return services;
    },
    toast: {
      success() {},
      error() {
        throw new Error("Unexpected toast in focused recovery path");
      },
    },
    localStorage: { getItem: () => null, setItem() {} },
    document,
    HTMLElement: Element,
  });
  function render() {
    for (let pass = 0; pass < 12; pass++) {
      cursor = 0;
      dirty = false;
      tree = renderComponent(props);
      for (const node of elements(tree, (item) => item.props.ref)) {
        const target = element(
          node.props.role === "alert"
            ? "delete-error"
            : node.type === "p"
              ? "memory-summary"
              : "member-feedback",
        );
        if (typeof node.props.ref === "function") node.props.ref(target);
        else node.props.ref.current = target;
      }
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return;
    }
    throw new Error("Hooks did not settle");
  }
  render();
  const find = (predicate) => elements(tree, predicate)[0];
  const button = (label) =>
    find((node) => node.type === "Button" && text(node).replace(/\s+/g, " ").trim() === label);
  const input = () => find((node) => node.type === "Input");
  const members = () => find((node) => node.type === "MembersTab");
  return {
    props,
    auth,
    requests,
    writes,
    focused,
    document,
    element,
    render,
    find,
    button,
    input,
    members,
    text: () => text(tree),
    empty: () =>
      find((node) => node.type === "EmptyState" && node.props.title === "No memories yet"),
    change(value) {
      input().props.onChange({ target: { value } });
      render();
    },
    enter() {
      input().props.onKeyDown({
        key: "Enter",
        nativeEvent: { isComposing: false },
        preventDefault() {},
      });
    },
    openDelete() {
      find((node) => node.props["aria-label"] === "Delete memory").props.onClick({
        currentTarget: element("memory-delete-trigger"),
      });
      render();
    },
    dialog: () => find((node) => node.type === "Dialog"),
    async finish(name, index, value, reject = false) {
      requests[name][index][reject ? "reject" : "resolve"](value);
      await settle();
      render();
    },
    unmount() {
      alive = false;
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}
const row = (id = "memory-a", content = "Keep the agreed style") => ({ id, content });
async function loaded(kind = "memory") {
  const f = fixture(kind);
  if (kind === "memory") await f.finish("list", 0, [row()]);
  else {
    await settle();
    f.render();
  }
  return f;
}

test("memory initial failure is persistent and retryable without claiming the project is empty", async () => {
  const f = fixture();
  assert.equal(f.empty(), undefined);
  await f.finish("list", 0, new Error("memory offline"), true);
  assert.match(f.text(), /Memories could not be loaded.*memory offline/s);
  assert.equal(f.empty(), undefined);
  f.button("Retry loading memories").props.onClick();
  f.button("Retry loading memories").props.onClick();
  assert.equal(f.requests.list.length, 2);
  f.render();
  assert.match(f.text(), /memory offline/);
  assert.ok(f.button("Retrying…").props.disabled);
  await f.finish("list", 1, []);
  assert.ok(f.empty());
  assert.doesNotMatch(f.text(), /memory offline/);
});

test("memory add is single-flight even for two Enter events before rerender and applies only a confirmed row", async () => {
  const f = await loaded();
  f.change("  A new fact  ");
  f.enter();
  f.enter();
  assert.equal(f.requests.add.length, 1);
  assert.deepEqual(f.requests.add[0].args, {
    data: { project_id: "project-a", content: "A new fact" },
  });
  assert.doesNotMatch(f.text(), /A new fact/);
  f.change("Next draft typed while saving");
  await f.finish("add", 0, row("memory-b", "A new fact"));
  assert.match(f.text(), /A new fact.*Keep the agreed style/s);
  assert.equal(f.input().props.value, "Next draft typed while saving");
  assert.equal(f.requests.list.length, 1);
  f.enter();
  await f.finish("add", 1, row("memory-c", "Next draft typed while saving"));
  assert.equal(f.input().props.value, "");
});

test("memory add failure keeps the draft and list, stays visible while typing and refresh fails, then can retry", async () => {
  const f = await loaded();
  f.change("Keep this draft");
  f.enter();
  await f.finish("add", 0, new Error("write interrupted"), true);
  assert.equal(f.input().props.value, "Keep this draft");
  assert.match(f.text(), /Could not confirm.*write interrupted.*Keep the agreed style/s);
  f.change("Edited draft");
  assert.match(f.text(), /write interrupted/);
  f.button("Refresh memories").props.onClick();
  f.render();
  f.enter();
  assert.equal(f.requests.add.length, 1);
  await f.finish("list", 1, new Error("refresh offline"), true);
  assert.match(f.text(), /Previously loaded memories are still shown.*Keep the agreed style/s);
  assert.equal(f.empty(), undefined);
  assert.equal(f.input().props.value, "Edited draft");
  f.button("Retry loading memories").props.onClick();
  await f.finish("list", 2, [row()]);
  assert.match(f.text(), /write interrupted/);
  f.enter();
  await f.finish("add", 1, row("memory-b", "Edited draft"));
  assert.doesNotMatch(f.text(), /write interrupted|refresh offline/);
  assert.equal(f.input().props.value, "");
});

test("memory deletion retains confirmation, target and error on failure; retry is serialized and success removes only the target", async () => {
  const f = await loaded();
  f.openDelete();
  const confirm = f.button("Remove");
  confirm.props.onClick();
  confirm.props.onClick();
  assert.equal(f.requests.delete.length, 1);
  assert.deepEqual(f.requests.delete[0].args, { data: { id: "memory-a" } });
  f.dialog().props.onOpenChange(false);
  f.render();
  assert.equal(f.dialog().props.open, true);
  assert.match(f.text(), /Keep the agreed style/);
  await f.finish("delete", 0, new Error("delete interrupted"), true);
  assert.equal(f.dialog().props.open, true);
  assert.match(f.text(), /delete interrupted/);
  assert.equal(f.focused.at(-1), "delete-error");
  assert.equal(f.button("Cancel").props.disabled, false);
  f.button("Retry removal").props.onClick();
  f.render();
  assert.match(f.text(), /delete interrupted/);
  assert.equal(f.requests.delete.length, 2);
  f.element("memory-delete-trigger").isConnected = false;
  const closeFocus = f.find((node) => node.type === "DialogContent").props.onCloseAutoFocus;
  await f.finish("delete", 1, { ok: true });
  assert.equal(f.dialog().props.open, false);
  assert.doesNotMatch(f.text(), /Keep the agreed style|delete interrupted/);
  assert.ok(f.empty());
  closeFocus({ preventDefault() {} });
  assert.equal(f.focused.at(-1), "memory-summary");
});

test("cancelling failed memory deletion leaves the row and restores its trigger focus", async () => {
  const f = await loaded();
  f.openDelete();
  f.button("Remove").props.onClick();
  await f.finish("delete", 0, new Error("retry later"), true);
  const closeFocus = f.find((node) => node.type === "DialogContent").props.onCloseAutoFocus;
  f.button("Cancel").props.onClick();
  f.render();
  closeFocus({ preventDefault() {} });
  assert.equal(f.dialog().props.open, false);
  assert.match(f.text(), /Keep the agreed style/);
  assert.equal(f.focused.at(-1), "memory-delete-trigger");
  assert.equal(f.requests.delete.length, 1);
});

for (const change of ["project", "account", "signout", "unmount"]) {
  for (const operation of ["list", "add", "delete"]) {
    test(`memory ignores a late ${operation} after ${change}, including errors and old callbacks`, async () => {
      const f = operation === "list" ? fixture() : await loaded();
      if (operation === "add") {
        f.change("Account A draft");
        f.enter();
      }
      if (operation === "delete") {
        f.openDelete();
        f.button("Remove").props.onClick();
      }
      const oldSubmit = f.input().props.onKeyDown;
      if (change === "unmount") f.unmount();
      else {
        if (change === "project") f.props.projectId = "project-b";
        if (change === "account") f.auth.user = { id: "account-b" };
        if (change === "signout") {
          f.auth.isSignedIn = false;
          f.auth.user = null;
        }
        f.render();
        if (change !== "signout")
          await f.finish("list", f.requests.list.length - 1, [row("new", "New scope only")]);
      }
      const count = f.writes.length;
      const calls = f.requests.add?.length ?? 0;
      f.requests[operation][0].reject(new Error("old failure must stay hidden"));
      await settle();
      oldSubmit({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault() {} });
      assert.equal(f.writes.length, count);
      assert.equal(f.requests.add?.length ?? 0, calls);
      assert.equal(
        f.writes.some((write) => !write.alive),
        false,
      );
      if (change !== "unmount") {
        f.render();
        assert.doesNotMatch(f.text(), /old failure|Keep the agreed style/);
        assert.equal(f.input().props.value, "");
      }
    });
  }
}

for (const kind of ["remove", "revoke"]) {
  const invoke = (f) =>
    kind === "remove"
      ? f.members().props.onRemove("member-a")
      : f.members().props.onRevoke("invite-a");
  const count = (f) =>
    kind === "remove" ? f.members().props.members.length : f.members().props.invites.length;
  test(`member ${kind} keeps rows on failure, shows named persistent retry/cancel, and serializes retries`, async () => {
    const f = await loaded("members");
    const before = count(f);
    const first = invoke(f);
    const duplicate = invoke(f);
    await settle();
    f.render();
    assert.equal(f.requests[kind].length, 1);
    assert.equal(count(f), before);
    assert.deepEqual(
      f.requests[kind][0].args,
      kind === "remove"
        ? { data: { project_id: "project-a", user_id: "member-a" } }
        : { data: { id: "invite-a" } },
    );
    await f.finish(kind, 0, new Error("member service offline"), true);
    await Promise.all([first, duplicate]);
    assert.equal(count(f), before);
    assert.match(
      f.text(),
      new RegExp(`Could not confirm.*${kind === "remove" ? "member" : "invite"}@example.invalid`),
    );
    assert.match(f.text(), /member service offline/);
    assert.equal(f.focused.at(-1), "member-feedback");
    const retry = f.button(kind === "remove" ? "Retry removal" : "Retry revocation");
    retry.props.onClick();
    retry.props.onClick();
    await settle();
    f.render();
    assert.equal(f.requests[kind].length, 2);
    assert.match(f.text(), /member service offline/);
    assert.ok(f.button("Cancel").props.disabled);
    await f.finish(kind, 1, { ok: true });
    assert.equal(count(f), before - 1);
    assert.doesNotMatch(f.text(), /member service offline/);
    assert.match(f.text(), kind === "remove" ? /removed from this project/ : /Invitation revoked/);
    assert.equal(f.focused.at(-1), "member-feedback");
  });
  test(`cancelling failed ${kind} restores the original control and makes no further request`, async () => {
    const f = await loaded("members");
    const pending = invoke(f);
    await settle();
    await f.finish(kind, 0, new Error("offline"), true);
    await pending;
    f.button("Cancel").props.onClick();
    f.render();
    assert.equal(f.focused.at(-1), "original-trigger");
    assert.equal(f.requests[kind].length, 1);
    assert.doesNotMatch(f.text(), /Could not confirm/);
  });
  for (const change of ["project", "account", "unmount"]) {
    test(`member ${kind} ignores late ${change} responses and a saved stale retry callback`, async () => {
      const f = await loaded("members");
      const pending = invoke(f);
      await settle();
      await f.finish(kind, 0, new Error("retained failure"), true);
      await pending;
      const oldRetry = f.button(kind === "remove" ? "Retry removal" : "Retry revocation").props
        .onClick;
      oldRetry();
      await settle();
      if (change === "unmount") f.unmount();
      else {
        if (change === "project") f.props.projectId = "project-b";
        else f.auth.user = { id: "account-b" };
        f.render();
        await settle();
        f.render();
      }
      const before = f.writes.length;
      f.requests[kind][1].resolve({ ok: true });
      await settle();
      oldRetry();
      await settle();
      assert.equal(f.requests[kind].length, 2);
      assert.equal(f.writes.length, before);
      assert.equal(
        f.writes.some((write) => !write.alive),
        false,
      );
      if (change !== "unmount") {
        f.render();
        assert.doesNotMatch(
          f.text(),
          /retained failure|removed from this project|Invitation revoked/,
        );
        assert.equal(f.members().props.members.length, 2);
        assert.equal(f.members().props.invites.length, 1);
      }
    });
  }
}

test("member callbacks recheck account/project before the deferred secure-facade import issues a request", async () => {
  const f = await loaded("members");
  const pending = f.members().props.onRevoke("invite-a");
  f.auth.user = { id: "account-b" };
  f.render();
  await pending;
  await settle();
  f.render();
  assert.equal(f.requests.revoke, undefined);
});

test("memory Enter during IME composition and viewer mutations remain blocked", async () => {
  const f = await loaded();
  f.change("Composition draft");
  f.input().props.onKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: true },
    preventDefault() {
      assert.fail("IME Enter must not be prevented");
    },
  });
  assert.equal(f.requests.add, undefined);
  f.props.canEdit = false;
  f.render();
  assert.equal(f.input(), undefined);
  assert.equal(
    f.find((node) => node.props["aria-label"] === "Delete memory"),
    undefined,
  );
});

for (const change of ["project", "account", "signout", "unmount"]) {
  for (const operation of ["list", "add", "delete"]) {
    test(`memory ignores a late successful ${operation} after ${change}`, async () => {
      const f = operation === "list" ? fixture() : await loaded();
      if (operation === "add") {
        f.change("Old scope draft");
        f.enter();
      }
      if (operation === "delete") {
        f.openDelete();
        f.button("Remove").props.onClick();
      }
      if (change === "unmount") f.unmount();
      else {
        if (change === "project") f.props.projectId = "project-b";
        if (change === "account") f.auth.user = { id: "account-b" };
        if (change === "signout") {
          f.auth.isSignedIn = false;
          f.auth.user = null;
        }
        f.render();
        if (change !== "signout") {
          // Deliberately reuse an ID: an old successful delete must not affect this scope's row.
          await f.finish("list", f.requests.list.length - 1, [
            row("memory-a", "Current account data"),
          ]);
          f.change("Current account draft");
        }
      }
      const before = f.writes.length;
      f.requests[operation][0].resolve(
        operation === "list"
          ? [row("old", "Old response")]
          : operation === "add"
            ? row("old", "Old response")
            : { ok: true },
      );
      await settle();
      assert.equal(f.writes.length, before);
      if (change !== "unmount") {
        f.render();
        assert.doesNotMatch(f.text(), /Old response/);
        if (change !== "signout") {
          assert.match(f.text(), /Current account data/);
          assert.equal(f.input().props.value, "Current account draft");
        }
      }
    });
  }
}

for (const operation of ["list", "add", "delete"]) {
  test(`memory ${operation} from an earlier account-A visit stays obsolete after A→B→A`, async () => {
    const f = operation === "list" ? fixture() : await loaded();
    if (operation === "add") {
      f.change("Earlier draft");
      f.enter();
    }
    if (operation === "delete") {
      f.openDelete();
      f.button("Remove").props.onClick();
    }
    for (const id of ["account-b", "account-a"]) {
      f.auth.user = { id };
      f.render();
      await f.finish("list", f.requests.list.length - 1, [row("memory-a", `Fresh ${id} row`)]);
    }
    f.change("Latest A draft");
    const before = f.writes.length;
    f.requests[operation][0].resolve(
      operation === "list" ? [] : operation === "add" ? row("old", "Old add") : { ok: true },
    );
    await settle();
    f.render();
    assert.equal(f.writes.length, before);
    assert.match(f.text(), /Fresh account-a row/);
    assert.equal(f.input().props.value, "Latest A draft");
  });
}

for (const kind of ["remove", "revoke"]) {
  test(`member ${kind} from an earlier A visit cannot complete or retry after A→B→A`, async () => {
    const f = await loaded("members");
    const original =
      kind === "remove"
        ? f.members().props.onRemove("member-a")
        : f.members().props.onRevoke("invite-a");
    await settle();
    await f.finish(kind, 0, new Error("A failure"), true);
    await original;
    const retry = f.button(kind === "remove" ? "Retry removal" : "Retry revocation").props.onClick;
    retry();
    await settle();
    for (const id of ["account-b", "account-a"]) {
      f.auth.user = { id };
      f.render();
      await settle();
      f.render();
    }
    const before = f.writes.length;
    f.requests[kind][1].resolve({ ok: true });
    await settle();
    retry();
    await settle();
    f.render();
    assert.equal(f.writes.length, before);
    assert.equal(f.requests[kind].length, 2);
    assert.equal(f.members().props.members.length, 2);
    assert.equal(f.members().props.invites.length, 1);
    assert.doesNotMatch(f.text(), /A failure|removed from this project|Invitation revoked/);
  });
  for (const change of ["account", "signout"]) {
    test(`member ${kind} late failure after ${change} stays silent and retains current rows`, async () => {
      const f = await loaded("members");
      const pending =
        kind === "remove"
          ? f.members().props.onRemove("member-a")
          : f.members().props.onRevoke("invite-a");
      await settle();
      f.auth.user = change === "account" ? { id: "account-b" } : null;
      if (change === "signout") f.auth.isSignedIn = false;
      f.render();
      await settle();
      f.render();
      const before = f.writes.length;
      f.requests[kind][0].reject(new Error("Obsolete failure"));
      await pending;
      await settle();
      f.render();
      assert.equal(f.writes.length, before);
      assert.doesNotMatch(f.text(), /Obsolete failure|Could not confirm/);
      if (change === "account") {
        assert.equal(f.members().props.members.length, 2);
        assert.equal(f.members().props.invites.length, 1);
      }
    });
  }
}

test("explicit memory Retry focuses persistent summary once and completion never steals focus", async () => {
  const f = fixture();
  assert.deepEqual(f.focused, []);
  await f.finish("list", 0, new Error("offline"), true);
  f.button("Retry loading memories").props.onClick();
  assert.equal(f.document.activeElement, f.element("memory-summary"));
  f.element("later-control").focus();
  await f.finish("list", 1, [row()]);
  assert.equal(f.document.activeElement, f.element("later-control"));
  assert.deepEqual(f.focused, ["memory-summary", "later-control"]);
});

test("memory Add keeps a stable focus destination without stealing focus on settlement", async () => {
  const f = await loaded();
  f.change("Disposable sample");
  f.enter();
  assert.equal(f.document.activeElement, f.element("memory-summary"));
  f.element("later-control").focus();
  await f.finish("add", 0, new Error("offline"), true);
  assert.equal(f.document.activeElement, f.element("later-control"));
  assert.equal(f.find((node) => node.type === "Input").props.value, "Disposable sample");
});
