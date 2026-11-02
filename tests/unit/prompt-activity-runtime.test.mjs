import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";

const icon = (name) => Symbol(name);
const icons = Object.fromEntries(
  ["CalendarDays", "FileText", "Globe", "Loader2", "Mail", "Copy", "Check"].map((name) => [
    name,
    icon(name),
  ]),
);
const menus = Object.fromEntries(
  ["ContextMenu", "ContextMenuTrigger", "ContextMenuContent", "ContextMenuItem"].map((name) => [
    name,
    Symbol(name),
  ]),
);
const { MessageActivityList } = loadUiModule("src/components/MessageActivityList.tsx", {
  "lucide-react": icons,
});
const { PromptMessage } = loadUiModule("src/components/PromptMessage.tsx", {
  "lucide-react": icons,
  "@/components/ui/context-menu": menus,
});
const rows = (tree) => elements(tree, (node) => node.type === "li");
const buttons = (tree) => elements(tree, (node) => node.type === "button");

test("activity grows in arrival order and retains running and completed steps", () => {
  const first = { tool: "search_web", label: "Searching example.com", status: "running" };
  const before = MessageActivityList({ activities: [first] });
  assert.equal(rows(before).length, 1);
  assert.match(text(before), /In progress\s*:.*Searching example.com/);
  const after = MessageActivityList({
    activities: [
      { ...first, status: "done" },
      { tool: "drive_read", label: "Reading demo document", status: "running" },
    ],
  });
  assert.deepEqual(
    rows(after).map((row) => row.key),
    [0, 1],
  );
  assert.match(text(rows(after)[0]), /Completed\s*:.*Searching example.com/);
  assert.match(text(rows(after)[1]), /In progress\s*:.*Reading demo document/);
  assert.equal(after.type, "ol");
  assert.equal(after.props["aria-label"], "Activity");
  assert.equal(elements(after, (node) => node.type === "details").length, 0);
});

test("failed and canceled activities retain truthful visible state", () => {
  const tree = MessageActivityList({
    activities: [
      { tool: "gmail_read", label: "Reading Gmail", status: "failed" },
      { tool: "calendar_check", label: "Checking Calendar", status: "canceled" },
    ],
  });
  assert.match(text(rows(tree)[0]), /Failed\s*:/);
  assert.equal(rows(tree)[0].props["data-status"], "failed");
  assert.match(text(rows(tree)[1]), /Canceled\s*:/);
  assert.equal(elements(tree, (node) => node.type === icons.Loader2).length, 0);
});

test("scheduled task receipts stay separate and empty lists do not render", () => {
  assert.equal(MessageActivityList({}), null);
  assert.equal(
    MessageActivityList({
      activities: [{ tool: "scheduled_task", label: "Task created", status: "done" }],
    }),
    null,
  );
});

test("activity labels are plain text, with no fetched favicon or injected site markup", () => {
  const label = "<img src=x onerror=alert(1)>";
  const tree = MessageActivityList({
    activities: [{ tool: "read_source", label, status: "done" }],
  });
  assert.ok(text(tree).includes(label));
  assert.equal(elements(tree, (node) => node.type === "img" || node.type === "a").length, 0);
});

test("sent prompts expose one inline copy button and retain exact text", () => {
  let copied = 0;
  const content = "First line\nSecond line <literal>";
  const tree = PromptMessage({
    content,
    copied: false,
    onCopy: () => copied++,
    onEdit() {},
    onBranch() {},
  });
  const controls = buttons(tree);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].props["aria-label"], "Copy prompt");
  controls[0].props.onClick();
  assert.equal(copied, 1);
  assert.ok(text(tree).includes(content));
});

test("successful copy switches the same control to the checkmark state", () => {
  const tree = PromptMessage({ content: "Demo", copied: true, onCopy() {} });
  assert.equal(buttons(tree).length, 1);
  assert.equal(buttons(tree)[0].props["data-copied"], true);
  assert.equal(buttons(tree)[0].props["aria-label"], "Copied prompt");
  assert.match(text(tree), /Prompt copied/);
});

test("edit and branch remain context menu actions without inline buttons", () => {
  let edit = 0;
  let branch = 0;
  const tree = PromptMessage({
    content: "Demo",
    copied: false,
    onCopy() {},
    onEdit: () => edit++,
    onBranch: () => branch++,
  });
  const items = elements(tree, (node) => node.type === menus.ContextMenuItem);
  items.find((item) => text(item) === "Edit message").props.onSelect();
  items.find((item) => text(item).startsWith("Branch from")).props.onSelect();
  assert.equal(edit, 1);
  assert.equal(branch, 1);
  assert.equal(buttons(tree).length, 1);
});
