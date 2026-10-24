import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/WorkspaceIntelligence.tsx", "utf8");
const start = source.indexOf("export function RelatedWorkspaceItems");
const javascript = ts.transpileModule(source.slice(start).replace("export function", "function"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const settle = () => new Promise(setImmediate);
const children = (node) => (node && typeof node === "object" ? (node.children ?? []) : []);
const flatten = (node) =>
  Array.isArray(node) ? node.flatMap(flatten) : [node, ...children(node).flatMap(flatten)];
const text = (node) =>
  flatten(node)
    .filter((part) => typeof part === "string")
    .join(" ");

// Run the actual component's state/effects and JSX with small hook doubles.
// These are deterministic component-contract tests, not browser evidence.
function fixture() {
  let auth = { isLoaded: true, isSignedIn: true, user: { id: "owner-a" } };
  let index = 0,
    pendingEffects = [],
    tree;
  const slots = [],
    requests = [];
  const list = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useUser: () => auth,
    chatStoragePrincipal: (key) => (key ? `user:${key}` : "guest"),
    useServerFn: () => list,
    listWorkspaceIntelligence: {},
    IntelligenceRow: "workspace-row",
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        (value) => (slots[slot] = typeof value === "function" ? value(slots[slot]) : value),
      ];
    },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const Component = new Function(
    ...Object.keys(dependencies),
    `${javascript}; return RelatedWorkspaceItems;`,
  )(...Object.values(dependencies));
  return {
    requests,
    setAuth(value) {
      auth = value;
    },
    render(props = {}) {
      index = 0;
      pendingEffects = [];
      tree = Component(props);
      return tree;
    },
    commit() {
      pendingEffects.splice(0).forEach((effect) => effect());
    },
    retry() {
      const button = flatten(tree).find((node) => node?.type === "button");
      assert.ok(button);
      button.props.onClick();
    },
  };
}

const item = (id, kind = "project") => ({
  id,
  title: id,
  kind,
  href: `/projects/${id}`,
  projectId: id,
});

test("related workspace reports load failure distinctly and Retry can recover to a verified empty response", async () => {
  const f = fixture();
  assert.match(text(f.render()), /Loading related workspace items/);
  f.commit();
  f.requests[0].reject(new Error("offline"));
  await settle();
  const failed = f.render();
  assert.match(text(failed), /Related workspace items are unavailable/);
  assert.doesNotMatch(text(failed), /No explicit related/);
  assert.ok(flatten(failed).some((node) => node?.props?.role === "alert"));
  f.retry();
  f.render();
  f.commit();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve([]);
  await settle();
  const empty = f.render();
  assert.match(text(empty), /No explicit related items yet/);
  assert.doesNotMatch(text(empty), /unavailable/);
});

test("Related workspace links keep the requested project/context-pack/file/memory kinds and a six-item cap", async () => {
  const f = fixture();
  const props = { kinds: ["project", "context_pack", "file", "memory"] };
  f.render(props);
  f.commit();
  f.requests[0].resolve([
    item("excluded-chat", "chat"),
    ...["project", "context_pack", "file", "memory", "project", "file", "memory"].map((kind, i) =>
      item(String(i), kind),
    ),
  ]);
  await settle();
  const rows = flatten(f.render(props)).filter((node) => node?.type === "workspace-row");
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.slice(0, 4).map((node) => node.props.item.kind),
    props.kinds,
  );
  assert.ok(rows.every((node) => node.props.userKey === "owner-a"));
  assert.match(source, /to=\{item\.href\}/);
});

test("account and project changes hide old rows before effects and ignore superseded responses", async () => {
  const f = fixture();
  f.render();
  f.commit();
  f.requests[0].resolve([item("old")]);
  await settle();
  assert.ok(flatten(f.render()).some((node) => node?.type === "workspace-row"));
  f.setAuth({ isLoaded: true, isSignedIn: true, user: { id: "owner-b" } });
  const changing = f.render();
  assert.match(text(changing), /Loading related workspace items/);
  assert.ok(!flatten(changing).some((node) => node?.type === "workspace-row"));
  f.commit();
  f.render({ projectId: "new-project" });
  f.commit();
  f.requests[1].resolve([item("old-project")]);
  await settle();
  assert.match(text(f.render({ projectId: "new-project" })), /Loading related workspace/);
  f.requests[2].resolve([item("new-project")]);
  await settle();
  const rows = flatten(f.render({ projectId: "new-project" })).filter(
    (node) => node?.type === "workspace-row",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].props.item.id, "new-project");
  assert.equal(rows[0].props.userKey, "owner-b");
});

test("signed-out or unresolved owners neither expose links nor request workspace data", () => {
  for (const auth of [
    { isLoaded: false, isSignedIn: false, user: null },
    { isLoaded: true, isSignedIn: false, user: null },
  ]) {
    const f = fixture();
    f.setAuth(auth);
    assert.equal(f.render(), null);
    f.commit();
    assert.equal(f.requests.length, 0);
  }
});
