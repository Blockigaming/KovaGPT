import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PATHS } from "./private-http-review.mjs";
import {
  createReviewStateHandler,
  REVIEW_STATE_OPTIONS,
  installReviewState,
  readReviewFunctionNames,
} from "./review-state-fixtures.mjs";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  jsxRuntime,
} from "../tests/helpers/ui-state-harness.mjs";
const scenario = "route-error-recovery";
const names = readReviewFunctionNames();
const entry = [...names].find(([, value]) => value.split("_")[0] === "listKnowledgeGraph");
assert.ok(entry);
const url = `http://127.0.0.1:4189/_serverFn/${entry[0]}`;
function fixture() {
  const state = { active: true };
  const handler = createReviewStateHandler(scenario, "free", names, 0, {
    isActive: () => state.active,
  });
  return {
    state,
    async read(options = {}) {
      let response;
      await handler({
        request: () => ({
          url: () => options.url ?? url,
          method: () => options.method ?? "GET",
          headers: () => options.headers ?? {},
          postData: () => options.body ?? null,
        }),
        fulfill: async (value) => {
          response = value;
        },
        fallback: async () => {
          response = { fallback: true };
        },
      });
      return response;
    },
  };
}
test("read-only route error fixture is authenticated, bounded and one-shot after valid reads", async () => {
  assert.ok(PATHS.includes("/synthetic-missing-review-page"));
  assert.equal(REVIEW_STATE_OPTIONS.find((entry) => entry.id === scenario).path, null);
  assert.throws(() => createReviewStateHandler(scenario, "guest", names), /requires a synthetic/);
  await assert.rejects(installReviewState({}, scenario, "free"), /ordinary private HTTP/);
  const f = fixture();
  for (const method of ["POST", "PUT", "DELETE", "PATCH"])
    assert.equal((await f.read({ method })).status, 405);
  assert.equal((await f.read({ url: url + "?owner=other" })).status, 400);
  assert.equal((await f.read({ body: "{}" })).status, 400);
  assert.equal((await f.read({ headers: { "x-kova-owner": "other" } })).status, 401);
  assert.equal((await f.read()).json.result.nodes[0].label, null);
  for (let i = 0; i < 3; i++)
    assert.deepEqual((await f.read()).json.result, { nodes: [], edges: [] });
  f.state.active = false;
  assert.equal((await f.read()).status, 401);
  assert.equal((await fixture().read()).json.result.nodes[0].label, null);
});
function graphHarness(read) {
  const h = createHookHarness();
  const { Route } = loadUiModule("src/routes/knowledge-graph.tsx", {
    react: { ...h.react, useMemo: (fn) => fn() },
    "@tanstack/react-router": { createFileRoute: () => (x) => x, Link: "Link" },
    "@tanstack/react-start": { useServerFn: () => read },
    "lucide-react": { Clock3: "Clock3", Network: "Network", Search: "Search" },
    "@/components/AppShell": { AppShell: "AppShell" },
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "synthetic-owner" } }),
    },
    "@/lib/professional.functions": { listKnowledgeGraph: {} },
    "@/lib/chat-store": {
      chatStoragePrincipal: (x) => x,
      loadConversations: () => [],
      savePendingActive() {},
    },
  });
  return { render: () => h.render(Route.component), unmount: h.unmount };
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
test("actual KnowledgeGraph throws on malformed render and recovers after remount/read", async () => {
  const f = fixture();
  const read = async () => (await f.read()).json.result;
  const first = graphHarness(read);
  first.render();
  await settle();
  assert.throws(() => first.render(), /toLowerCase/);
  first.unmount();
  const retry = graphHarness(read);
  retry.render();
  await settle();
  assert.match(text(retry.render()), /Knowledge Graph/);
  retry.unmount();
});
function rootRoute(router) {
  // Execute the unchanged actual component body; unrelated root head metadata
  // contains Vite import.meta syntax not supported by the CommonJS UI harness.
  const source = readFileSync("src/routes/__root.tsx", "utf8");
  const component = source.slice(
    source.indexOf("function ErrorComponent("),
    source.indexOf("export const Route ="),
  );
  const compiled = ts.transpileModule("export " + component, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    useRouter: () => router,
    require: (id) => {
      assert.equal(id, "react/jsx-runtime");
      return jsxRuntime;
    },
  });
  return { errorComponent: exports.ErrorComponent };
}

test("actual root error Retry awaits invalidation and resets on success or failure; Return home is a root link", async () => {
  for (const reject of [false, true]) {
    const calls = [];
    let release;
    const pending = new Promise((resolve, fail) => {
      release = () => (reject ? fail(new Error("synthetic failure")) : resolve());
    });
    const Route = rootRoute({
      invalidate: () => {
        calls.push("invalidate");
        return pending;
      },
    });
    const tree = Route.errorComponent({
      error: new Error("sample"),
      reset: () => calls.push("reset"),
    });
    assert.match(text(tree), /This page couldn’t load/);
    assert.equal(
      elements(tree, (n) => n.type === "a" && text(n) === "Return home")[0].props.href,
      "/",
    );
    const action = elements(
      tree,
      (n) => n.type === "button" && text(n) === "Retry",
    )[0].props.onClick();
    assert.deepEqual(calls, ["invalidate"]);
    release();
    if (reject) await assert.rejects(action, /synthetic failure/);
    else await action;
    assert.deepEqual(calls, ["invalidate", "reset"]);
  }
});
