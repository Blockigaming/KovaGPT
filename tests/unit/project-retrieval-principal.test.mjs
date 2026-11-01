import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const route = readFileSync("src/routes/api/chat.ts", "utf8");
const start = route.indexOf('let projectBlock = "";');
const end = route.indexOf("// Chat-scoped workspace context:", start);
assert.ok(start >= 0 && end > start, "The actual project context boundary must be available");
const projectContext = route
  .slice(start, end)
  .replace('const { retrieveProjectContext } = await import("@/lib/project-rag.server");', "");
assert.doesNotMatch(projectContext, /\bimport\s*\(/u);
const rag = readFileSync("src/lib/project-rag.server.ts", "utf8");
const retrieveStart = rag.indexOf("export async function retrieveProjectContext(");
assert.ok(retrieveStart >= 0, "Exercise the actual project retrieval implementation");
const retrieveCode = stripTypeScriptTypes(rag.slice(retrieveStart).replace(/^export\s+/u, ""));
const contextCode = stripTypeScriptTypes(projectContext);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runContext = new AsyncFunction(
  "auth",
  "usesExistingContext",
  "projectId",
  "preflight",
  "messages",
  "memorySourceRefs",
  "retrieveProjectContext",
  "ChatPreflightError",
  "logSafeFailure",
  "logContext",
  `${contextCode}\nreturn projectBlock;`,
);

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const OWNER = "123e4567-e89b-42d3-a456-426614174001";
const FILE = "123e4567-e89b-42d3-a456-426614174002";
const CONTENT = "Cedar checkpoint CEDAR-7294. The approved budget is 27 credits.";

function fixture({ member = true, rpcError = null } = {}) {
  const calls = [];
  const controller = new AbortController();
  const vector = [1, 0, 0];
  const retrieveProjectContext = new Function(
    "embedOne",
    `${retrieveCode}\nreturn retrieveProjectContext;`,
  )(async (query, signal) => {
    assert.ok(query.includes("checkpoint"));
    assert.equal(signal, controller.signal);
    return vector;
  });
  const user = {
    rpc(name, args) {
      calls.push({ client: "user", name, args });
      assert.equal(name, "match_project_chunks");
      assert.equal(args._project_id, PROJECT);
      assert.equal(args.query_embedding, vector);
      assert.equal(args.match_count, 6);
      return {
        abortSignal(signal) {
          assert.equal(signal, controller.signal);
          return Promise.resolve({
            error: rpcError,
            data: rpcError ? null : [{ file_id: FILE, content: CONTENT, similarity: 0.9 }],
          });
        },
      };
    },
  };
  const admin = {
    rpc(name, args) {
      calls.push({ client: "admin", name, args });
      if (name === "match_project_chunks") return Promise.resolve({ data: [], error: null });
      assert.equal(name, "is_project_member");
      assert.deepEqual(args, { _user_id: OWNER, _project_id: PROJECT });
      return Promise.resolve({ data: member, error: null });
    },
    from(table) {
      calls.push({ client: "admin", table });
      assert.ok(table === "projects" || table === "project_memory");
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          assert.equal(column, table === "projects" ? "id" : "project_id");
          assert.equal(value, PROJECT);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: PROJECT, name: "Cedar" }, error: null });
        },
      };
      return query;
    },
  };
  async function run({
    authProvider = "supabase",
    auth = true,
    context = true,
    id = PROJECT,
  } = {}) {
    return runContext(
      auth ? { authProvider, userId: OWNER, supabaseUser: user, supabaseAdmin: admin } : null,
      context,
      id,
      { run: async (_stage, operation) => operation(controller.signal) },
      [{ role: "user", content: "What are the checkpoint and approved budget?" }],
      [],
      retrieveProjectContext,
      class ChatPreflightError extends Error {},
      () => {},
      {},
    );
  }
  return { run, calls };
}

for (const authProvider of ["supabase", "kova"]) {
  test(`${authProvider} project search retains the verified caller's RPC identity`, async () => {
    const { run, calls } = fixture();
    const block = await run({ authProvider });
    assert.ok(block.includes(CONTENT), "The indexed passage must reach the model context");
    assert.equal(calls.filter((call) => call.name === "match_project_chunks").length, 1);
    assert.equal(calls.find((call) => call.name === "match_project_chunks").client, "user");
  });
}

test("a nonmember cannot start retrieval or read project context", async () => {
  const { run, calls } = fixture({ member: false });
  assert.equal(await run(), "");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["is_project_member"],
  );
});

test("a denied user RPC never falls back to an admin search", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { run, calls } = fixture({ rpcError: { code: "42501", message: "permission denied" } });
  assert.ok(!(await run()).includes(CONTENT));
  assert.deepEqual(
    calls.filter((call) => call.name === "match_project_chunks").map((call) => call.client),
    ["user"],
  );
});

test("guests, disabled existing context and malformed project IDs perform no project calls", async () => {
  for (const options of [{ auth: false }, { context: false }, { id: "not-a-project" }]) {
    const { run, calls } = fixture();
    assert.equal(await run(options), "");
    assert.deepEqual(calls, []);
  }
});
