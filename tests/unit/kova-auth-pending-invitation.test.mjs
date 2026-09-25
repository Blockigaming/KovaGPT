import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = ts.transpileModule(readFileSync("src/lib/projects.functions.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const owner = "10000000-0000-4000-8000-000000000001";
const project = "20000000-0000-4000-8000-000000000002";
function fixture({ failure = false } = {}) {
  const calls = [];
  const exports = {};
  const modules = {
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: "verified-middleware" },
    "@/lib/supabase-loose": { loose: (client) => client },
    "./response-sources.ts": { normalizeResponseSources: () => [] },
    "@tanstack/react-start": {
      createServerFn: () => {
        let validator = (value) => value;
        const builder = {
          middleware: () => builder,
          validator: (next) => {
            validator = next;
            return builder;
          },
          handler:
            (run) =>
            ({ data, context }) =>
              run({ data: validator(data), context }),
        };
        return builder;
      },
    },
  };
  vm.runInNewContext(source, {
    exports,
    console: { error() {} },
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unapproved dependency: ${name}`);
      return modules[name];
    },
  });
  const context = {
    userId: owner,
    claims: { email: "owner@example.invalid" },
    supabase: {
      from: (table) => {
        assert.equal(table, "project_invites");
        return {
          upsert: (value, options) => {
            calls.push(JSON.parse(JSON.stringify({ table, value, options })));
            return {
              select: () => ({
                single: async () =>
                  failure ? { error: { message: "RLS denied" } } : { data: { id: "invite-id" } },
              }),
            };
          },
        };
      },
    },
  };
  return { calls, run: (data) => exports.inviteMember({ data, context }) };
}

test("actual project invitation handler never enumerates hosted users or auto-grants membership", async () => {
  const f = fixture();
  const result = await f.run({
    project_id: project,
    email: "Recipient@Example.invalid",
    role: "viewer",
  });
  assert.equal(result.auto_accepted, false);
  assert.equal(result.id, "invite-id");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].value, {
    project_id: project,
    email: "recipient@example.invalid",
    role: "viewer",
    invited_by: owner,
    status: "pending",
    accepted_at: null,
  });
});
test("self-invitation and invalid roles or addresses cannot reach the pending invitation write", async () => {
  const f = fixture();
  for (const data of [
    { project_id: project, email: "OWNER@example.invalid" },
    { project_id: project, email: "bad" },
    { project_id: project, email: "valid@example.invalid", role: "owner" },
  ]) {
    await assert.rejects(async () => f.run(data));
  }
  assert.equal(f.calls.length, 0);
});
test("caller-RLS rejection never falls back to administrator membership writes or reports success", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(
    f.run({ project_id: project, email: "recipient@example.invalid" }),
    /Failed to invite/u,
  );
  assert.equal(f.calls.length, 1);
});
