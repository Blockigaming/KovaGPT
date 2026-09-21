import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/components/KovaPasswordPanel.tsx", "utf8"), {
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

function fixture(options = {}) {
  const state = [],
    effects = [],
    calls = [],
    messages = [];
  let cursor = 0,
    tree;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
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
    useEffect(run, deps) {
      const index = cursor++;
      if (!state[index] || deps.some((value, i) => !Object.is(value, state[index].deps[i]))) {
        state[index] = { deps };
        effects.push(run);
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
        success: (message) => messages.push(["success", message]),
        error: (message) => messages.push(["error", message]),
      },
    },
    "@/lib/kova-auth-browser": {
      clearKovaAuthCache: () => calls.push(["clear-cache"]),
      async kovaAuthJson(path, body) {
        calls.push(["POST", path, JSON.parse(JSON.stringify(body))]);
        if (options.hold) await options.hold;
        if (options.reject) throw Error("sensitive upstream message");
        return Response.json(options.badPayload ? { changed: false } : { changed: true }, {
          status: options.failure ? 503 : 200,
        });
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Error,
    Response,
    TextEncoder,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
    fetch: async (path) => {
      calls.push(["GET", path]);
      return Response.json({ hasPassword: options.hasPassword ?? true });
    },
  });
  const render = () => {
    cursor = 0;
    tree = exports.KovaPasswordPanel();
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      render();
      for (const effect of effects.splice(0)) effect();
      await new Promise((resolve) => setImmediate(resolve));
    }
    render();
  };
  const find = (type, predicate) => {
    const found = nodes(tree).find((node) => node.type === type && predicate(node));
    assert.ok(found, `Missing ${type}`);
    return found;
  };
  const click = async (label) => {
    const node = find("button", (node) => text(node) === label);
    assert.notEqual(node.props.disabled, true);
    await node.props.onClick();
    await flush();
  };
  const input = async (id, value) => {
    find("input", (node) => node.props.id === id).props.onChange({ target: { value } });
    await flush();
  };
  const submit = () => find("form", () => true).props.onSubmit({ preventDefault() {} });
  return {
    flush,
    click,
    input,
    submit,
    render,
    calls,
    messages,
    get tree() {
      return tree;
    },
  };
}

async function fill(
  f,
  {
    current = "test original password",
    next = "test replacement password",
    confirmation = next,
  } = {},
) {
  await f.flush();
  await f.click("Change password");
  await f.input("kova-current-password", current);
  await f.input("kova-new-password", next);
  await f.input("kova-confirm-password", confirmation);
}

test("password controls stay unavailable without an owned credential", async () => {
  const f = fixture({ hasPassword: false });
  await f.flush();
  assert.ok(text(f.tree).includes("does not have a Kova password"));
  assert.equal(
    nodes(f.tree).filter((node) => node.type === "form" || node.type === "input").length,
    0,
  );
  assert.ok(!f.calls.some(([method]) => method === "POST"));
});

test("password form submits only the current/new values, clears them and invalidates old tokens", async () => {
  const f = fixture();
  await fill(f);
  await f.submit();
  await f.flush();
  const request = f.calls.find(([method]) => method === "POST");
  assert.deepEqual(request, [
    "POST",
    "/api/auth/password",
    { currentPassword: "test original password", newPassword: "test replacement password" },
  ]);
  assert.ok(f.calls.some(([method]) => method === "clear-cache"));
  assert.equal(f.messages.at(-1)[0], "success");
  assert.equal(nodes(f.tree).filter((node) => node.type === "input").length, 0);
  await f.click("Change password");
  assert.ok(
    nodes(f.tree)
      .filter((node) => node.type === "input")
      .every((node) => node.props.value === ""),
  );
});

test("mismatched, reused, short and oversized new passwords never reach the endpoint", async () => {
  for (const data of [
    { confirmation: "does not match" },
    { next: "short" },
    { next: "test original password" },
    { next: "\u{1f642}".repeat(300) },
  ]) {
    const f = fixture();
    await fill(f, data);
    await f.submit();
    await f.flush();
    assert.ok(!f.calls.some(([method]) => method === "POST"));
    assert.equal(f.messages.at(-1)[0], "error");
  }
});

test("in-flight password changes cannot be duplicated or cancelled", async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ hold });
  await fill(f);
  const first = f.submit();
  const second = f.submit();
  await f.flush();
  assert.equal(f.calls.filter(([method]) => method === "POST").length, 1);
  assert.ok(
    nodes(f.tree)
      .filter((node) => node.type === "input" || node.type === "button")
      .every((node) => node.props.disabled),
  );
  release();
  await Promise.all([first, second]);
  await f.flush();
});

test("uncertain failures clear plaintext fields and never expose transport details or claim success", async () => {
  for (const options of [{ reject: true }, { failure: true }, { badPayload: true }]) {
    const f = fixture(options);
    await fill(f);
    await f.submit();
    await f.flush();
    assert.equal(f.messages.at(-1)[0], "error");
    assert.ok(!JSON.stringify(f.messages).includes("sensitive upstream"));
    assert.ok(
      nodes(f.tree)
        .filter((node) => node.type === "input")
        .every((node) => node.props.value === ""),
    );
    assert.ok(f.calls.some(([method]) => method === "clear-cache"));
  }
});

test("cancelling a password edit discards its fields without a mutation", async () => {
  const f = fixture();
  await fill(f);
  await f.click("Cancel");
  await f.click("Change password");
  assert.ok(
    nodes(f.tree)
      .filter((node) => node.type === "input")
      .every((node) => node.props.value === ""),
  );
  assert.ok(!f.calls.some(([method]) => method === "POST"));
});