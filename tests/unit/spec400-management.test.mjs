import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  parseProjectListPreferences,
  parseScheduledTaskListPreferences,
} from "../../src/lib/management-list-preferences.mjs";
const source = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const schedules = source("src/routes/scheduled-tasks.tsx");
const editor = source("src/components/ScheduledTaskEditor.tsx");
const projects = source("src/routes/projects.tsx");
const project = source("src/routes/projects.$projectId.tsx");
const library = source("src/routes/library.tsx");
const upload = source("src/components/LibraryUploadDialog.tsx");
const css = source("src/styles/spec400-management.css");

test("management TSX sources parse without diagnostics", () => {
  for (const file of [
    "src/routes/scheduled-tasks.tsx",
    "src/components/ScheduledTaskEditor.tsx",
    "src/routes/projects.tsx",
    "src/routes/projects.$projectId.tsx",
    "src/routes/library.tsx",
    "src/components/LibraryUploadDialog.tsx",
  ]) {
    const result = ts.transpileModule(source(file), {
      fileName: file,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    assert.deepEqual(result.diagnostics, [], file);
  }
});
test("scheduled-task page uses exact labels and real Active/Paused/All counts", () => {
  assert.match(schedules, /Scheduled tasks\s*<\/h1>/);
  assert.match(schedules, /Run a prompt automatically on a schedule/);
  assert.match(schedules, /New scheduled task/);
  assert.equal(parseScheduledTaskListPreferences(null).filter, "active");
  assert.match(
    schedules,
    /usePrincipalSessionPreferences\([\s\S]*?parseScheduledTaskListPreferences/,
  );
  assert.match(schedules, /\["active", "paused", "all"\]/);
  assert.match(schedules, /tasks\s*\.filter\(/);
  for (const label of ["Open", "Edit", "View runs", "Resume", "Pause", "Delete"])
    assert.ok(schedules.includes(label));
});
test("task deep links only open authorized records and creation receipt follows persistence", () => {
  assert.match(schedules, /validateSearch:[\s\S]*?taskId/);
  assert.match(schedules, /tasks\.find\(\(task\) => task.id === requestedTaskId\)/);
  assert.match(schedules, /not accessible to this account/);
  assert.match(editor, /const persistedTask = await create/);
  assert.match(editor, /if \(active.current\) onCreated\?\.\(persistedTask\)/);
  assert.match(schedules, /onCreated=\{\(persistedTask\) => setCreatedTask\(persistedTask\)\}/);
});
test("schedule mutations retain idempotent retry and principal pinning", () => {
  assert.match(editor, /pending.current = operation/);
  const tree = ts.createSourceFile(
    "ScheduledTaskEditor.tsx",
    editor,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const retries = [];
  const isPendingIdentity = (node) =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "pending" &&
    node.name.text === "current";
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "send" &&
      node.arguments.some(isPendingIdentity)
    )
      retries.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(retries.length >= 2, "Save retry and recovery action reuse the pending operation");
  for (const retry of retries) {
    assert.ok(
      isPendingIdentity(retry.arguments[0]),
      "Retry must pass the pending operation by identity",
    );
    assert.ok(
      retry.arguments.length <= 2,
      "Only an optional captured focus origin accompanies retry",
    );
  }
  assert.match(editor, /expectedUserId: userKey/);
  assert.match(schedules, /expectedRevision: operation.revision/);
  assert.match(schedules, /pendingTaskIdsRef.current.has\(id\)/);
});
test("schedule fields expose existing defaults and honest preview/notification gaps", () => {
  assert.match(editor, /task\?\.repeat \?\? draft\?\.repeat \?\? "daily"/);
  assert.match(editor, /date.setHours\(9, 0, 0, 0\)/);
  assert.match(editor, /Frequency/);
  assert.match(editor, /Weekday/);
  assert.match(editor, /last day of a shorter month/);
  assert.match(editor, /three-run preview is not available/);
  assert.match(
    editor.replace(/\s+/g, " "),
    /separate notification preference per task is not supported/,
  );
  assert.match(editor, /Actual start:/);
});
test("schedule save is explicit, modal, busy-guarded, and preserves uncertain requests", () => {
  assert.match(editor, /<Dialog\s+open/);
  assert.match(editor, /Discard unsaved schedule changes/);
  assert.match(editor, /if \(busyRef.current\) return/);
  assert.match(editor, /Save schedule/);
  assert.match(editor, /validateScheduledTaskDraft/);
  assert.match(editor, /Couldn’t confirm task creation/);
  assert.match(css, /spec400-schedule-footer[\s\S]*?position: sticky/);
});
test("project directory keeps real sorting, access metadata and principal-scoped view preferences", () => {
  assert.equal(parseProjectListPreferences(null).sort, "opened");
  assert.match(
    projects,
    /usePrincipalSessionPreferences\([\s\S]*?parseProjectDirectoryPreferences/,
  );
  assert.match(projects, /Last opened/);
  assert.match(projects, /<SelectItem value="updated">Last modified<\/SelectItem>/);
  assert.match(projects, /<SelectItem value="opened-help" disabled>/);
  assert.match(projects, /onValueChange=\{\(value\) => setSortBy\(value as typeof sortBy\)\}/);
  assert.match(
    projects,
    /<SelectTrigger\s+className="kova-project-sort"\s+aria-label="Sort projects"\s+aria-describedby="project-sort-explanation"/,
  );
  assert.match(projects, /<span>Name<\/span>\s*<span>Access<\/span>\s*<span>Last modified<\/span>/);
  assert.match(
    projects,
    /p\.role === "owner" \? "Owner" : p\.role === "editor" \? "Editor" : "Viewer"/,
  );
  assert.match(projects, /<time dateTime=\{p\.updated_at\}/);
  assert.match(projects, /kova-project-opened/);
  assert.match(projects, /createBusyRef.current/);
  assert.doesNotMatch(projects, /\bp\.(?:chat_count|file_count)\b/);
});
test("new project directories default to list without overriding saved or migrated views", () => {
  const tree = ts.createSourceFile(
    "projects.tsx",
    projects,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "parseProjectDirectoryPreferences",
  );
  assert.ok(declaration);
  const code = ts.transpileModule(`return (${declaration.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const parse = new Function("parseProjectListPreferences", code)(parseProjectListPreferences);
  assert.deepEqual(parse(null), { ...parseProjectListPreferences(null), view: "list" });
  for (const view of ["grid", "list"]) {
    const saved = { query: "Private project", sort: "name", scope: "owned", archived: true, view };
    assert.deepEqual(parse(JSON.stringify(saved)), saved);
  }
  // Existing legacy/canonical records without a view preserve the shared parser's default.
  const migrated = JSON.stringify({ query: "Existing", sort: "updated", scope: "shared" });
  assert.deepEqual(parse(migrated), parseProjectListPreferences(migrated));
});
test("project details retain association and explicitly save instructions", () => {
  const primaryTabs = [
    '<TabsTrigger value="chats">Chats</TabsTrigger>',
    '<TabsTrigger value="files">Files</TabsTrigger>',
    '<TabsTrigger value="context">Context</TabsTrigger>',
  ].map((tab) => project.indexOf(tab));
  assert.ok(primaryTabs.every((offset) => offset >= 0));
  assert.ok(primaryTabs[0] < primaryTabs[1] && primaryTabs[1] < primaryTabs[2]);
  assert.match(project, /aria-label="More project tools"/);
  const tools = project.match(
    /<DropdownMenuRadioGroup value=\{tab\} onValueChange=\{setTab\}>([\s\S]*?)<\/DropdownMenuRadioGroup>/,
  );
  assert.ok(tools);
  assert.deepEqual(
    [...tools[1].matchAll(/<DropdownMenuRadioItem value="([^"]+)"/g)].map((match) => match[1]),
    [
      "overview",
      "timers",
      "files",
      "images",
      "notes",
      "tasks",
      "memory",
      "members",
      "collaboration",
      "settings",
    ],
  );
  assert.match(tools[1], /isOwner \? "Settings" : "Access"/);
  assert.match(project, /New chat in project/);
  assert.match(project, /project_id: projectId, title: "New chat", messages: \[\]/);
  assert.match(project, /Save changes/);
  assert.match(project, /projectInstructionDrafts.set\(draftKey, value\)/);
  assert.match(project, /await onSaveRef.current/);
});
test("project grids use content-width breakpoints and specified card geometry", () => {
  assert.match(css, /@container \(min-width: 620px\)/);
  assert.match(css, /@container \(min-width: 960px\)/);
  assert.match(css, /min-height: 156px/);
  assert.match(css, /padding: 20px/);
  assert.match(css, /gap: 24px/);
  assert.match(css, /gap: 16px/);
});
test("Library defaults to List and filters one existing collection", () => {
  assert.match(library, /if \(typeof window === "undefined"\) return "list"/);
  for (const label of ["All", "Uploads", "Documents", "Images", "Code"])
    assert.ok(library.includes(`label: "${label}"`));
  assert.match(library, /Clear filters/);
  assert.match(library, /Date saved, newest first/);
  assert.match(library, /not select the entire Library/);
  assert.match(library, /References unavailable/);
  assert.match(library, /File Trash and moving files to projects are not supported here/);
  assert.match(library, /Rename saved title/);
  assert.match(library, /<Trash2 aria-hidden="true" \/> Chat Trash/);
  assert.match(library, /files and other saved items use the permanent-delete confirmation/);
});
test("Library upload uses existing extraction, ownership, cancellation and quota contracts", () => {
  assert.match(upload, /LIBRARY_ORIGINAL_MAX_BYTES/);
  assert.match(upload, /ORIGINAL_DOCUMENT_MIMES/);
  assert.match(upload, /createWorkViewLifetime\(ownerId/);
  assert.match(upload, /extractDocumentFile\(file, current.controller.signal\)/);
  assert.match(upload, /saveOriginalLibraryFile\(/);
  assert.match(upload, /operationId.current \?\?= crypto.randomUUID\(\)/);
  assert.match(upload, /current.controller.signal.throwIfAborted/);
  assert.match(upload, /setStatus\("ready"\)/);
});
test("management style preserves baseline color tokens and 420px inspector", () => {
  assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b/i);
  assert.match(css, /max-width: 1200px/);
  assert.match(css, /width: 420px/);
  assert.match(css, /width: min\(560px/);
  assert.match(css, /height: 100dvh/);
});
