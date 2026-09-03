import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("src/lib/projects.functions.ts", "utf8");
const workspaceServer = readFileSync("src/lib/project-workspace.functions.ts", "utf8");
const route = readFileSync("src/routes/projects.$projectId.tsx", "utf8");

test("project detail carries archived state into the restore control", () => {
  const detailType = server.slice(
    server.indexOf("export type ProjectDetail"),
    server.indexOf("export type ProjectMember"),
  );
  const getProject = server.slice(
    server.indexOf("export const getProject"),
    server.indexOf("export const updateProject"),
  );

  assert.match(detailType, /archived_at: string \| null/);
  assert.match(getProject, /updated_at, archived_at/);
  assert.match(route, /useState<ProjectDetail \| null>\(null\)/);
  assert.match(route, /const archived = !!project\.archived_at/);
  assert.match(route, /archived: !archived/);
  assert.match(route, /archived \? "Project restored" : "Project archived"/);
  assert.match(route, /<ArchiveRestore/);
  assert.match(route, /archiveBusy \? "Restoring…" : "Restore"/);
});

test("project archive writes require an owner row and the control cannot report false success", () => {
  const archive = workspaceServer.slice(
    workspaceServer.indexOf("export const setProjectArchived"),
    workspaceServer.indexOf("// ============= SEARCH"),
  );
  assert.match(archive, /\.eq\("owner_id", context\.userId\)/);
  assert.match(archive, /\.select\("id"\)[\s\S]{0,40}\.maybeSingle\(\)/);
  assert.match(archive, /if \(!updated\)/);
  assert.match(route, /const \[archiveBusy, setArchiveBusy\] = useState\(false\)/);
  assert.match(route, /disabled=\{archiveBusy\}/);
  assert.match(route, /aria-busy=\{archiveBusy\}/);
  assert.match(route, /catch \(error\)[\s\S]{0,240}toast\.error/);
  assert.match(route, /finally[\s\S]{0,160}setArchiveBusy\(false\)/);
  assert.doesNotMatch(route, /setProject\(p as never\)/);
});
