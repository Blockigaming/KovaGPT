import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
const source = readFileSync("src/lib/projects.functions.ts", "utf8");
const fragment = source.slice(source.indexOf("export const deleteProjectChat ="));
function fixture({ denied = false, archived = false, missing = false } = {}) {
  const calls = [];
  let validator, handler;
  const builder = {
    middleware() {
      return this;
    },
    validator(fn) {
      validator = fn;
      return this;
    },
    handler(fn) {
      handler = fn;
      return fn;
    },
  };
  const js = ts.transpileModule(fragment.replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("createServerFn", "requireSupabaseAuth", "z", "loose", js)(
    () => builder,
    {},
    z,
    (client) => client,
  );
  const context = {
    userId: "caller",
    supabase: {
      from(table) {
        let deleting = false;
        const query = {
          select() {
            return this;
          },
          eq(...args) {
            calls.push([table, ...args]);
            return this;
          },
          delete() {
            deleting = true;
            calls.push(["delete", table]);
            return this;
          },
          async maybeSingle() {
            if (table === "projects")
              return {
                data: { archived_at: archived ? "date" : null, deletion_requested_at: null },
                error: null,
              };
            if (deleting)
              return {
                data: denied ? null : { id: "11111111-1111-4111-8111-111111111111" },
                error: null,
              };
            return { data: missing ? null : { project_id: "project" }, error: null };
          },
        };
        return query;
      },
    },
  };
  return {
    calls,
    validator,
    run: () => handler({ data: { id: "11111111-1111-4111-8111-111111111111" }, context }),
  };
}
test("project chat deletion uses caller RLS and confirms the exact removed row", async () => {
  const f = fixture();
  assert.equal((await f.run()).ok, true);
  assert.deepEqual(
    f.calls.find((c) => c[0] === "delete"),
    ["delete", "project_chats"],
  );
  assert.ok(f.calls.some((c) => c[1] === "project_id" && c[2] === "project"));
  assert.throws(() => f.validator({ id: "bad" }));
  assert.doesNotMatch(fragment, /supabaseAdmin|Trash/);
});
test("denied, missing, and archived project chats cannot report a successful delete", async () => {
  for (const input of [{ denied: true }, { missing: true }, { archived: true }])
    await assert.rejects(fixture(input).run());
});
test("project chat entry points expose permanent confirmation and no recoverable-Trash dependency", () => {
  for (const path of [
    "src/routes/projects.$projectId.tsx",
    "src/routes/projects.$projectId.chat.$chatId.tsx",
  ]) {
    const text = readFileSync(path, "utf8");
    assert.match(text, /confirmPermanentChat/);
    assert.doesNotMatch(text, /PROJECT_CHAT_DELETE_UNAVAILABLE/);
  }
});
