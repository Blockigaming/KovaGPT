import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/components/MfaPanel.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const codes = Array.from({ length: 8 }, (_, index) => `${"r".repeat(42)}${index}`);
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object") return text(node.props?.children);
  return String(node);
};
const nodes = (node) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
};

// Execute the actual component and click its actual callbacks with controlled
// hooks/transport. No browser account, authenticator, or external service is used.
function fixture(options = {}) {
  const calls = [];
  const messages = [];
  const logs = [];
  const hooks = [];
  const effects = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let remaining = options.remaining ?? 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [
        hooks[index].value,
        (next) => {
          hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      hooks[index] ??= { current: initial };
      return hooks[index];
    },
    useCallback(run, dependencies) {
      const index = cursor++;
      if (
        !hooks[index] ||
        dependencies.some((value, i) => !Object.is(value, hooks[index].dependencies[i]))
      ) {
        hooks[index] = { value: run, dependencies };
      }
      return hooks[index].value;
    },
    useEffect(run, dependencies) {
      const index = cursor++;
      if (
        !hooks[index] ||
        dependencies.some((value, i) => !Object.is(value, hooks[index].dependencies[i]))
      ) {
        hooks[index] = { dependencies };
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
    "@/components/PasskeyPanel": { PasskeyPanel: "legacy-passkeys" },
    "@/components/KovaPasswordPanel": { KovaPasswordPanel: "owned-password" },
    "@/components/KovaPasskeyPanel": { KovaPasskeyPanel: "owned-passkeys" },
    "@/lib/kova-auth-browser": {
      isKovaSessionActive: () => options.owned !== false,
      clearKovaAuthCache: () => calls.push(["clear-cache"]),
      async kovaAuthJson(path, body) {
        calls.push(["owned", path, plain(body)]);
        if (options.hold) await options.hold;
        if (options.reject) throw Error(`transport failed ${codes[0]}`);
        if (options.failure)
          return Response.json({ error: `raw provider secret ${codes[0]}` }, { status: 503 });
        if (path.includes("recovery/regenerate")) {
          remaining = 8;
          return Response.json({
            recoveryCodes: options.codes === undefined ? codes : options.codes,
          });
        }
        return Response.json({ revokedCount: options.revokedCount ?? 1 });
      },
    },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          mfa: {
            listFactors: async () => {
              calls.push(["legacy-list"]);
              return { data: { totp: [{ id: "factor", status: "verified" }] } };
            },
          },
          signOut: async (value) => {
            calls.push(["legacy-signout", plain(value)]);
            return {};
          },
        },
      },
    },
    sonner: {
      toast: {
        success: (message) => messages.push(["success", message]),
        error: (message) => messages.push(["error", message]),
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Error,
    Response,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
    console: { error: (...args) => logs.push(args) },
    fetch: async (path) => {
      calls.push(["fetch", path]);
      return Response.json({
        factors: [{ id: "factor", friendlyName: "Fixture", recoveryCodesRemaining: remaining }],
      });
    },
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports.MfaPanel();
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (dirty) render();
    }
  }
  function button(label) {
    const item = nodes(tree).find((item) => item.type === "button" && text(item).trim() === label);
    assert.ok(item, `Expected button ${label}`);
    return item.props;
  }
  async function click(label) {
    const control = button(label);
    assert.ok(!control.disabled, `${label} should be enabled`);
    await control.onClick();
    await flush();
  }
  render();
  return {
    calls,
    logs,
    messages,
    button,
    click,
    flush,
    nodes: () => nodes(tree),
    text: () => text(tree),
  };
}

test("owned recovery settings require explicit confirmation, show exactly eight codes once, and clear dismissed codes", async () => {
  const f = fixture();
  await f.flush();
  assert.ok(f.text().includes("0 unused recovery codes remain."));
  assert.ok(!f.nodes().some((node) => node.type === "legacy-passkeys"));
  await f.click("Generate new recovery codes");
  assert.ok(f.text().includes("All existing recovery codes will stop working."));
  assert.equal(f.calls.filter(([kind]) => kind === "owned").length, 0);
  await f.click("Cancel");
  assert.equal(f.calls.filter(([kind]) => kind === "owned").length, 0);
  await f.click("Generate new recovery codes");
  await f.click("Replace recovery codes");
  assert.deepEqual(
    f.calls.filter(([kind]) => kind === "owned"),
    [["owned", "/api/auth/mfa/recovery/regenerate", { confirm: true }]],
  );
  assert.ok(f.text().includes("8 unused recovery codes remain."));
  const displayed = f.nodes().filter((node) => node.type === "li");
  assert.deepEqual(displayed.map(text), codes);
  assert.ok(displayed.every((node) => node.props.className.includes("break-all")));
  assert.equal(f.button("Generate new recovery codes").disabled, true);
  await f.click("I saved these codes");
  for (const code of codes) assert.ok(!f.text().includes(code));
  assert.equal(f.button("Generate new recovery codes").disabled, false);
  const transcript = JSON.stringify({ calls: f.calls, messages: f.messages, logs: f.logs });
  for (const code of codes) assert.ok(!transcript.includes(code));
  assert.ok(f.calls.some(([kind]) => kind === "clear-cache"));
});

test("recovery replacement synchronously rejects double clicks and blocks concurrent device changes", async () => {
  let release;
  const f = fixture({
    hold: new Promise((resolve) => {
      release = resolve;
    }),
  });
  await f.flush();
  await f.click("Generate new recovery codes");
  const click = f.button("Replace recovery codes").onClick;
  const revoke = f.button("Sign out other sessions").onClick;
  const first = click();
  await click();
  await revoke();
  assert.equal(f.calls.filter(([kind]) => kind === "owned").length, 1);
  release();
  await first;
  await f.flush();
  assert.equal(f.nodes().filter((node) => node.type === "li").length, 8);
});

test("malformed or failed regeneration responses never expose partial codes or provider secrets", async () => {
  for (const options of [
    { failure: true },
    { reject: true },
    { codes: null },
    { codes: codes.slice(0, 7) },
    { codes: [...codes, "extra"] },
    { codes: Array(8).fill(codes[0]) },
    { codes: ["short", ...codes.slice(1)] },
    { codes: [23, ...codes.slice(1)] },
  ]) {
    const f = fixture(options);
    await f.flush();
    await f.click("Generate new recovery codes");
    await f.click("Replace recovery codes");
    assert.equal(f.nodes().filter((node) => node.type === "li").length, 0);
    assert.equal(f.messages.filter(([kind]) => kind === "success").length, 0);
    assert.ok(f.messages.some(([kind]) => kind === "error"));
    const visible = JSON.stringify([f.text(), f.messages, f.logs]);
    assert.ok(!visible.includes("raw provider"));
    for (const code of codes) assert.ok(!visible.includes(code));
    assert.ok(!f.calls.some(([kind]) => kind.startsWith("legacy")));
  }
});

test("owned device revocation uses its real route and cannot fall back to Supabase on failure", async () => {
  for (const failure of [false, true]) {
    const f = fixture({ failure });
    await f.flush();
    await f.click("Sign out other sessions");
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === "owned"),
      [["owned", "/api/auth/sessions/revoke-others", {}]],
    );
    assert.equal(f.messages[0][0], failure ? "error" : "success");
    assert.ok(!f.calls.some(([kind]) => kind.startsWith("legacy")));
    assert.ok(!JSON.stringify(f.logs).includes(codes[0]));
  }
  const legacy = fixture({ owned: false });
  await legacy.flush();
  assert.ok(!legacy.text().includes("Generate new recovery codes"));
  assert.ok(legacy.nodes().some((node) => node.type === "legacy-passkeys"));
  await legacy.click("Sign out other sessions");
  assert.deepEqual(
    legacy.calls.filter(([kind]) => kind === "legacy-signout"),
    [["legacy-signout", { scope: "others" }]],
  );
  assert.ok(!legacy.calls.some(([kind]) => kind === "owned"));
});
