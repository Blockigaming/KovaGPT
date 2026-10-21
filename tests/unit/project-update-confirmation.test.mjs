import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("src/lib/projects.functions.ts", "utf8");
const fragment = source.slice(
  source.indexOf("export const updateProject ="),
  source.indexOf("export const deleteProject ="),
);
const ast = ts.createSourceFile(
  "update.ts",
  fragment,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
let handler;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "handler"
  )
    handler = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
const run = new Function(
  "console",
  `return (${ts
    .transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
    .outputText.trim()
    .replace(/;$/, "")});`,
)({ error() {} });
function fixture(result) {
  const calls = [];
  const query = {
    update(value) {
      calls.push(["update", value]);
      return this;
    },
    eq(...args) {
      calls.push(["eq", ...args]);
      return this;
    },
    select(value) {
      calls.push(["select", value]);
      return this;
    },
    async maybeSingle() {
      return result;
    },
  };
  return {
    calls,
    context: {
      userId: "owner",
      supabase: {
        from(table) {
          calls.push(["from", table]);
          return query;
        },
      },
    },
  };
}
test("project update confirms the requested owner-scoped row before success", async () => {
  const f = fixture({ data: { id: "project" }, error: null });
  assert.deepEqual(
    await run({ data: { id: "project", system_prompt: "Keep it clear" }, context: f.context }),
    { ok: true },
  );
  assert.ok(f.calls.some((x) => x[0] === "eq" && x[1] === "owner_id" && x[2] === "owner"));
  assert.deepEqual(
    f.calls.find((x) => x[0] === "update"),
    ["update", { system_prompt: "Keep it clear" }],
  );
});
for (const [name, result] of [
  ["no matching row", { data: null, error: null }],
  ["database failure", { data: null, error: { message: "denied" } }],
  ["unexpected identity", { data: { id: "other" }, error: null }],
]) {
  test(`project update does not report success on ${name}`, async () => {
    const f = fixture(result);
    await assert.rejects(
      run({ data: { id: "project", name: "Sample" }, context: f.context }),
      /could not be confirmed/,
    );
  });
}
test("Context instructions editing matches the existing owner-only update contract", () => {
  const route = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  assert.match(route, /const isOwner = project\.role === "owner"/);
  assert.match(route, /const archived = !!project\.archived_at/);
  const file = ts.createSourceFile(
    "project.tsx",
    route,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let canEdit;
  function find(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(file) === "ProjectInstructionsTab"
    ) {
      const attribute = node.attributes.properties.find(
        (item) => item.name?.getText(file) === "canEdit",
      );
      canEdit = attribute?.initializer?.expression?.getText(file);
    }
    ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(canEdit, "the mounted instructions editor has an explicit capability gate");
  const editable = new Function("isOwner", "archived", `return (${canEdit});`);
  for (const [role, archived, expected] of [
    ["owner", false, true],
    ["owner", true, false],
    ["editor", false, false],
    ["viewer", false, false],
  ])
    assert.equal(editable(role === "owner", archived), expected, `${role}, archived=${archived}`);
  assert.match(route, /Only the project owner can change these instructions\./);
});

test("template list does not invent a fifty-item truncation after paginated loading", () => {
  const source = readFileSync("src/components/ProjectTemplatesDialog.tsx", "utf8");
  assert.doesNotMatch(source, /Showing the 50 most recently updated templates/);
  const client = readFileSync("src/lib/project-template-client.ts", "utf8");
  assert.match(client, /if \(!value.hasMore\) return collected/);
});

test("Context recovery prose and Retry inherit readable theme foreground on the tinted panel", () => {
  const ui = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const panel = ui.slice(
    ui.indexOf('id="project-instructions-error"'),
    ui.indexOf("</div>", ui.indexOf('id="project-instructions-error"')),
  );
  assert.match(panel, /bg-destructive\/10/);
  assert.match(panel, /text-sm text-foreground/);
  assert.doesNotMatch(panel, /text-destructive/);
  assert.match(panel, /Your draft is preserved/);
  assert.match(panel, /Retry/);
});
