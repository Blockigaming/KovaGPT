import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const task = readFileSync("src/components/ScheduledTaskEditor.tsx", "utf8");
const project = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const chat = readFileSync("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");
const collaboration = readFileSync("src/components/ProjectCollaboration.tsx", "utf8");
test("task editor has ordered task, timing, and review headings without changing field identities", () => {
  const offsets = ["What should Kova do?", "When should it run?", "Review task"].map((label) =>
    task.indexOf(label),
  );
  assert.ok(offsets.every((offset) => offset > 0));
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
  assert.match(task, /Clock changes and month-end rules\s*<\/summary>/);
  assert.match(task, /Selected zone:/);
  assert.doesNotMatch(task, /Saved zone:/);
  assert.match(task, /<h3>Next confirmed run<\/h3>/);
  assert.match(task, /three-run preview is not available/);
});
test("archived project has a restore header and read-only content capabilities", () => {
  assert.match(
    project,
    /const canEdit = !archived && \(project.role === "owner" \|\| project.role === "editor"\)/,
  );
  assert.match(project, /archived && isOwner &&/);
  assert.match(project, /This project is archived and read-only/);
  assert.match(project, /Project members can see conversations created in this project/);
  assert.match(project, /canEdit=\{isOwner && !archived\}/);
  assert.match(project, /isOwner=\{isOwner && !archived\}/);
  assert.match(project, /readOnly=\{archived\}/);
  assert.match(project, /Restore this project before changing its settings/);
  assert.match(chat, /const canEdit = !project.archived_at/);
});
test("archived collaboration remains readable but cannot post or delete", () => {
  assert.match(collaboration, /readOnly \|\| !body.trim/);
  assert.match(collaboration, /readOnly \|\| !deletingComment/);
  assert.match(collaboration, /!readOnly && role !== "viewer"/);
  assert.match(collaboration, /!readOnly && \(comment.author_id/);
});
test("More actions opens existing named deletion and leave confirmations with exact opener restoration", () => {
  assert.match(project, /<DropdownMenuItem onSelect=\{\(\) => openProjectDelete\(\)\}/);
  assert.match(project, /projectActionTriggerRef.current = projectMoreRef.current/);
  assert.match(
    project,
    /restoreDialogFocus\(projectActionTriggerRef.current, projectActionUrlRef.current\)/,
  );
  assert.match(project, /title=\{`Delete “\$\{project.name\}”\?`\}/);
  assert.match(project, /Interrupted cleanup remains visible and retryable/);
  assert.match(project, /setDeleteError\(error instanceof Error/);
});
