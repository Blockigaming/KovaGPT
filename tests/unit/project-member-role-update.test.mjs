import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const file = ts.createSourceFile(
  "route.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(file) === "onChangeRole") {
    callback = node.initializer.expression.getText(file);
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback);
const javascript = ts.transpileModule(
  `return (${callback.replace('(await import("@/lib/projects.functions")).updateMemberRole', "(await Promise.resolve(projectFunctions)).updateMemberRole")});`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture() {
  let members = [
    { user_id: "a", email: "a@example.invalid", role: "viewer" },
    { user_id: "b", email: "b@example.invalid", role: "editor" },
  ];
  const initialMembers = members;
  const pending = [],
    errors = [];
  const operations = new Map();
  const request = { current: "owner:project" };
  const dependencies = {
    requestKey: request.current,
    projectId: "project",
    currentRequestKeyRef: request,
    memberRoleOperationsRef: { current: operations },
    projectFunctions: { updateMemberRole: "update-role" },
    callServerFnDirect: (fn, args) =>
      new Promise((resolve, reject) => pending.push({ fn, args, resolve, reject })),
    setMembers: (update) => {
      members = update(members);
    },
    toast: { error: (message) => errors.push(message) },
  };
  const change = new Function(...Object.keys(dependencies), javascript)(
    ...Object.values(dependencies),
  );
  return {
    change,
    pending,
    errors,
    operations,
    request,
    initialMembers,
    get members() {
      return members;
    },
  };
}
const flushImport = () => Promise.resolve();

test("successful member role changes preserve the workspace instead of refreshing or moving focus", async () => {
  const f = fixture();
  const result = f.change("a", "editor");
  await flushImport();
  assert.deepEqual(f.pending[0].args, {
    data: { project_id: "project", user_id: "a", role: "editor" },
  });
  f.pending[0].resolve({ ok: true });
  await result;
  assert.equal(f.members[0].role, "editor");
  assert.equal(f.members[1], f.initialMembers[1]);
  assert.doesNotMatch(callback, /refresh\(|\.focus\(|setLoading\(/);
  assert.equal(f.operations.size, 0);
});

test("only the latest role operation for each member updates local state", async () => {
  const f = fixture();
  const first = f.change("a", "editor");
  await flushImport();
  const second = f.change("a", "viewer");
  await flushImport();
  f.pending[1].resolve({ ok: true });
  await second;
  f.pending[0].resolve({ ok: true });
  await first;
  assert.equal(f.members[0].role, "viewer");
  assert.deepEqual(f.errors, []);
});

test("independent members can finish role updates in either order", async () => {
  const f = fixture();
  const first = f.change("a", "editor");
  const second = f.change("b", "viewer");
  await flushImport();
  f.pending[1].resolve({ ok: true });
  await second;
  f.pending[0].resolve({ ok: true });
  await first;
  assert.deepEqual(
    f.members.map((member) => member.role),
    ["editor", "viewer"],
  );
});

test("account or project changes and unmount cleanup invalidate pending role updates", async () => {
  for (const invalidate of [
    (f) => {
      f.request.current = "other:project";
    },
    (f) => f.operations.clear(),
  ]) {
    const f = fixture();
    const result = f.change("a", "editor");
    await flushImport();
    invalidate(f);
    f.pending[0].resolve({ ok: true });
    await result;
    assert.equal(f.members, f.initialMembers);
  }
  assert.match(
    source,
    /const operations = memberRoleOperationsRef.current;\s*return \(\) => operations.clear\(\);\s*}, \[isSignedIn, requestKey\]\)/,
  );
});

test("navigation during lazy import prevents an obsolete server mutation", async () => {
  const f = fixture();
  const result = f.change("a", "editor");
  f.request.current = "other:project";
  await result;
  assert.equal(f.pending.length, 0);
  assert.equal(f.members, f.initialMembers);
});

test("current failure reports an error without altering roles; stale failure stays quiet", async () => {
  for (const stale of [false, true]) {
    const f = fixture();
    const result = f.change("a", "editor");
    await flushImport();
    if (stale) f.operations.clear();
    f.pending[0].reject(new Error("Role update failed"));
    await result;
    assert.equal(f.members, f.initialMembers);
    assert.deepEqual(f.errors, stale ? [] : ["Role update failed"]);
  }
});
