import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "projects.functions.ts",
  readFileSync("src/lib/projects.functions.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const handlers = new Map();
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(source).endsWith(".handler")
  ) {
    const compiled = ts.transpileModule(
      `const handler=${node.initializer.arguments[0].getText(source)}`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    handlers.set(
      node.name.text,
      new Function(
        "console",
        "loose",
        "planTier",
        "PROJECT_LIMITS",
        compiled + "; return handler;",
      )(
        { error: () => {} },
        (client) => client,
        async () => "free",
        { free: { projects: 3 } },
      ),
    );
  }
  ts.forEachChild(node, visit);
}
visit(source);
function request(result) {
  const query = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "then") return (resolve) => Promise.resolve(result).then(resolve);
        return () => query;
      },
    },
  );
  return {
    data: { id: "project", project_id: "project" },
    context: {
      userId: "actor",
      claims: { email: "test@example.com" },
      supabase: { from: () => query },
    },
  };
}

for (const name of [
  "listProjects",
  "getProject",
  "listMembers",
  "listInvites",
  "listMyPendingInvites",
  "listProjectChats",
  "getProjectChat",
]) {
  test(`${name} rejects service failure instead of manufacturing empty/missing data`, async () => {
    assert.ok(handlers.has(name));
    await assert.rejects(
      handlers.get(name)(request({ data: null, error: { message: "private database detail" } })),
      (error) => {
        assert.match(error.message, /could not be loaded/);
        assert.doesNotMatch(error.message, /private database detail/);
        return true;
      },
    );
  });
}
test("genuine empty membership and missing records remain valid empty/missing states", async () => {
  assert.deepEqual(
    await handlers.get("listProjects")(request({ data: [], count: 0, error: null })),
    [],
  );
  assert.equal(await handlers.get("getProject")(request({ data: null, error: null })), null);
  assert.equal(await handlers.get("getProjectChat")(request({ data: null, error: null })), null);
});

for (const failure of ["error", "reject", "truncated"]) {
  test(`listProjects preserves available counts and marks ${failure} count data unknown`, async () => {
    let membersCalls = 0;
    const input = request({});
    input.context.supabase.from = (table) => {
      let result;
      if (table === "projects")
        result = { data: [{ id: "project", name: "Real project" }], count: 1, error: null };
      else if (table === "project_members" && membersCalls++ === 0)
        result = { data: [{ project_id: "project", role: "owner" }], count: 1, error: null };
      else if (table === "project_members")
        result = { data: [{ project_id: "project" }], count: 1, error: null };
      else if (table === "project_files") result = { data: [], count: 0, error: null };
      else
        result =
          failure === "error"
            ? { data: null, error: { message: "unavailable" } }
            : { data: [{ project_id: "project" }], count: 2000, error: null };
      const q = new Proxy(
        {},
        {
          get(_t, name) {
            if (name === "then")
              return (resolve, reject) =>
                table === "project_chats" && failure === "reject"
                  ? Promise.reject(new Error("network failure")).then(resolve, reject)
                  : Promise.resolve(result).then(resolve, reject);
            return () => q;
          },
        },
      );
      return q;
    };
    const [project] = await handlers.get("listProjects")(input);
    assert.equal(project.name, "Real project");
    assert.equal(project.member_count, 1);
    assert.equal(project.file_count, 0);
    assert.equal(project.chat_count, null);
  });
}
test("project creation refuses unavailable quota evidence before any privileged insert", async () => {
  for (const result of [
    { count: null, error: null },
    { count: 0, error: { message: "unavailable" } },
  ]) {
    // This handler stops before its privileged dynamic import on count failure.
    await assert.rejects(
      handlers.get("createProject")({ ...request(result) }),
      /limit could not be checked/,
    );
  }
});

test("project list traverses membership row caps and batches complete project rows", async () => {
  const all = Array.from({ length: 205 }, (_, i) => ({
    project_id: String(i).padStart(4, "0"),
    role: "owner",
  }));
  const pages = [];
  const batches = [];
  const input = request({});
  input.context.supabase.from = (table) => {
    let columns,
      cursor = null,
      ids;
    const query = {
      select(value) {
        columns = value;
        return query;
      },
      eq() {
        return query;
      },
      order() {
        return query;
      },
      limit() {
        return query;
      },
      gt(_key, value) {
        cursor = value;
        return query;
      },
      in(_key, value) {
        ids = value;
        return query;
      },
      then(resolve, reject) {
        if (table === "project_members" && columns === "project_id, role") {
          const remaining = all.filter((row) => !cursor || row.project_id > cursor);
          pages.push(cursor);
          return Promise.resolve({
            data: remaining.slice(0, 73),
            count: remaining.length,
            error: null,
          }).then(resolve, reject);
        }
        if (table === "projects") {
          batches.push(ids.length);
          return Promise.resolve({
            data: ids.map((id) => ({ id, name: id, updated_at: id })),
            count: ids.length,
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject);
      },
    };
    return query;
  };
  const rows = await handlers.get("listProjects")(input);
  assert.equal(rows.length, 205);
  assert.deepEqual(pages, [null, "0072", "0145"]);
  assert.deepEqual(batches, [100, 100, 5]);
  assert.equal(rows[0].id, "0204");
});
test("project list rejects a stalled membership cursor instead of showing an incomplete collection", async () => {
  await assert.rejects(
    handlers.get("listProjects")(request({ data: [], count: 10, error: null })),
    /completely/,
  );
});
test("duplicate project refuses unavailable quota before privileged insertion", async () => {
  await assert.rejects(
    handlers.get("duplicateProject")(
      request({ data: { name: "Original" }, count: null, error: null }),
    ),
    /limit could not be checked/,
  );
});
