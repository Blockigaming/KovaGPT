import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
function loadFunction(path, name, env) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let fn;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(fn);
  const js = ts.transpileModule(fn, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), js + `;return ${name};`)(...Object.values(env));
}
for (const [action, field] of [
  ["togglePin", "pinned_at", "pinnedAt"],
  ["toggleArchive", "archived_at", "archivedAt"],
]) {
  test(`${action} keeps the acknowledged timestamp for the next rename`, async () => {
    let rows = [{ id: "project", updated_at: "r0", pinned_at: null, archived_at: null }];
    const env = {
      userKey: "actor",
      currentUserKeyRef: { current: "actor" },
      projectMutationRef: { current: new Set() },
      setProjects: (update) => {
        rows = update(rows);
      },
      fnPin: async ({ data }) => {
        assert.equal(data.expectedUpdatedAt, "r0");
        return { ok: true, updatedAt: "r1", pinnedAt: "2026-10-12T00:00:00Z" };
      },
      fnArchive: async ({ data }) => {
        assert.equal(data.expectedUpdatedAt, "r0");
        return { ok: true, updatedAt: "r1", archivedAt: "2026-10-12T00:00:00Z" };
      },
      toast: {
        success() {},
        error(message) {
          throw Error(message);
        },
      },
      refresh: async () => {
        throw Error("Unexpected refresh");
      },
    };
    const fn = loadFunction("src/routes/projects.index.tsx", action, env);
    await fn(rows[0]);
    assert.equal(rows[0].updated_at, "r1");
    assert.equal(rows[0][field], "2026-10-12T00:00:00Z");
  });
}
test("project detail archive acknowledges metadata without remounting dirty tabs", async () => {
  let project = { id: "project", updated_at: "r0", system_prompt: "Saved", archived_at: null };
  const env = {
    project,
    archiveBusy: false,
    archiveOperation: { current: false },
    archiveReview: null,
    requestKey: "actor:project",
    currentRequestKeyRef: { current: "actor:project" },
    projectId: "project",
    archived: false,
    setArchiveBusy() {},
    fnArchive: async ({ data }) => {
      assert.equal(data.expectedUpdatedAt, "r0");
      return { ok: true, updatedAt: "r1", archivedAt: "2026-10-12T00:00:00Z" };
    },
    setProject: (update) => {
      project = update(project);
    },
    toast: {
      success() {},
      error(message) {
        throw Error(message);
      },
    },
    refresh: async () => {
      throw Error("Unexpected refresh");
    },
  };
  await loadFunction("src/routes/projects.$projectId.tsx", "toggleArchive", env)();
  assert.equal(project.updated_at, "r1");
  assert.equal(project.system_prompt, "Saved");
});

for (const [path, name, column] of [
  ["src/lib/projects.functions.ts", "pinProject", "pinned_at"],
  ["src/lib/project-workspace.functions.ts", "setProjectArchived", "archived_at"],
]) {
  test(`${name} rejects zero rows and returns the actual database revision and field`, async () => {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let body;
    function visit(n) {
      if (ts.isVariableDeclaration(n) && n.name.getText(source) === name)
        body = n.initializer.arguments[0].getText(source);
      ts.forEachChild(n, visit);
    }
    visit(source);
    const js = ts.transpileModule(`const handler=${body}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const handler = new Function("console", "logActivity", js + ";return handler;")(
      { error() {} },
      async () => {},
    );
    let result = { data: null, error: null };
    const query = {
      update: () => query,
      eq: () => query,
      select: (fields) => {
        assert.ok(fields.includes("updated_at"));
        assert.ok(fields.includes(column));
        return query;
      },
      maybeSingle: async () => result,
    };
    const input = {
      data: { id: "project", pinned: true, archived: true },
      context: { userId: "actor", supabase: { from: () => query } },
    };
    await assert.rejects(handler(input), /changed|not found|permission/);
    result = {
      data: { id: "project", updated_at: "database-revision", [column]: "database-field" },
      error: null,
    };
    const ack = await handler(input);
    assert.equal(ack.updatedAt, "database-revision");
    assert.equal(ack[column === "pinned_at" ? "pinnedAt" : "archivedAt"], "database-field");
  });
}

function reviewFixture() {
  let resolve;
  let project = { id: "project", updated_at: "r0", system_prompt: "Saved" };
  let review = "actor:project";
  const request = new Promise((r) => {
    resolve = r;
  });
  const notices = [];
  const env = {
    project,
    requestKey: "actor:project",
    projectId: "project",
    currentRequestKeyRef: { current: "actor:project" },
    archiveOperation: { current: false },
    setArchiveBusy() {},
    fnGet: () => request,
    setProject: (update) => {
      project = update(project);
    },
    setArchiveReview: (value) => {
      review = value;
    },
    toast: { error: (value) => notices.push(value) },
  };
  return {
    env,
    resolve,
    notices,
    get project() {
      return project;
    },
    get review() {
      return review;
    },
    update(value) {
      project = value;
    },
    run: loadFunction("src/routes/projects.$projectId.tsx", "reviewArchiveState", env),
  };
}
test("archive recovery reviews a full saved snapshot without refreshing/remounting or retrying archive", async () => {
  const f = reviewFixture();
  const pending = f.run();
  f.resolve({ id: "project", updated_at: "r1", system_prompt: "Remote" });
  await pending;
  assert.equal(f.project.updated_at, "r1");
  assert.equal(f.project.system_prompt, "Remote");
  assert.equal(f.review, null);
});
test("archive recovery cannot replace a newer local acknowledgement or another scope", async () => {
  for (const differentScope of [false, true]) {
    const f = reviewFixture();
    const pending = f.run();
    if (differentScope) f.env.currentRequestKeyRef.current = "other:project";
    else f.update({ id: "project", updated_at: "r2", system_prompt: "Newer" });
    f.resolve({ id: "project", updated_at: "r1", system_prompt: "Older remote" });
    await pending;
    assert.equal(f.project.updated_at, differentScope ? "r0" : "r2");
  }
});
test("archive recovery with lost access preserves snapshot and review requirement", async () => {
  const f = reviewFixture();
  const pending = f.run();
  f.resolve(null);
  await pending;
  assert.equal(f.project.updated_at, "r0");
  assert.equal(f.review, "actor:project");
  assert.match(f.notices[0], /draft is preserved/);
});
