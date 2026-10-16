import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.createSourceFile(
  "projects.tsx",
  readFileSync("src/routes/projects.index.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let refresh;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "refresh")
    refresh = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule(refresh, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(list, invites) {
  const state = {};
  const key = { current: "actor" };
  const env = {
    isSignedIn: true,
    userKey: "actor",
    currentUserKeyRef: key,
    refreshSequenceRef: { current: 0 },
    fnList: list,
    fnInvites: invites,
  };
  for (const name of [
    "Loading",
    "LoadError",
    "InviteError",
    "Projects",
    "Invites",
    "ResolvedUserKey",
  ])
    env["set" + name] = (value) => {
      state[name] = value;
    };
  return {
    state,
    key,
    refresh: new Function(...Object.keys(env), compiled + ";return refresh;")(
      ...Object.values(env),
    ),
  };
}
test("invitation failure does not hide a successful project list", async () => {
  const f = fixture(
    async () => [{ id: "real-project" }],
    async () => {
      throw Error("unavailable");
    },
  );
  await f.refresh();
  assert.deepEqual(f.state.Projects, [{ id: "real-project" }]);
  assert.equal(f.state.LoadError, null);
  assert.match(f.state.InviteError, /could not be loaded/);
  assert.equal(f.state.Loading, false);
});
test("project failure retains independently loaded invitations", async () => {
  const f = fixture(
    async () => {
      throw Error("unavailable");
    },
    async () => [{ id: "real-invite" }],
  );
  await f.refresh();
  assert.deepEqual(f.state.Invites, [{ id: "real-invite" }]);
  assert.match(f.state.LoadError, /Could not load/);
  assert.equal(f.state.InviteError, null);
});
test("late collection responses cannot populate the next account", async () => {
  const f = fixture(
    async () => {
      f.key.current = "other";
      return [{ id: "private" }];
    },
    async () => [],
  );
  await f.refresh();
  assert.equal(f.state.Projects, undefined);
  assert.equal(f.state.Invites, undefined);
});
