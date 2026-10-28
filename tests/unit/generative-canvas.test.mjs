import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { validateGenerativeWidget } from "../../src/lib/generative-ui.mjs";
import { resultRevisionDiff } from "../../src/lib/result-revision-diff.mjs";

function fixture(widget, overrides = {}) {
  const applied = [];
  const opened = [];
  const workspaces = [];
  const props = {
    widget,
    onDraftChange: (value) => applied.push(value),
    onOpenEditor: (...args) => opened.push(args),
    onOpenCanvas: (...args) => workspaces.push(args),
    ...overrides,
  };
  const rendered = reactFixture(
    "src/components/generative-ui/GenerativeCanvas.tsx",
    (exports) => () => exports.GenerativeCanvas(props),
    {
      modules: {
        "./generative-canvas.css": {},
        "@/lib/generative-ui.mjs": {
          // The test hook renderer runs callbacks in a VM realm. Normalizing
          // only that realm boundary keeps the real strict validator in use.
          validateGenerativeWidget: (value) =>
            validateGenerativeWidget(JSON.parse(JSON.stringify(value))),
        },
        "@/lib/result-revision-diff.mjs": { resultRevisionDiff },
        "@/components/ui/select": Object.fromEntries(
          ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
            name,
            name,
          ]),
        ),
      },
    },
  );
  return {
    ...rendered,
    applied,
    opened,
    workspaces,
    async change(type, predicate, value) {
      const field = rendered.find(type, predicate);
      if (type === "Select") field.props.onValueChange(value);
      else field.props.onChange({ target: { value } });
      await rendered.flush();
    },
  };
}
const writing = {
  version: 1,
  type: "document",
  title: "Working note",
  content: "Original sentence.\nKeep the second line.\n",
};

test("writing edits stay local, compare exact changes, discard, then apply and open the exact draft", async () => {
  const f = fixture(writing);
  await f.flush();
  assert.equal(f.find("button", (n) => n.props.children === "Apply draft").props.disabled, true);
  const edited = "Changed sentence.\nKeep the second line.\n  ";
  await f.change("textarea", () => true, edited);
  assert.equal(f.applied.length, 0);
  await f.click("Compare versions");
  assert.match(f.text(), /Changes from original/);
  assert.match(f.text(), /Original sentence/);
  assert.match(f.text(), /Changed sentence/);
  await f.click("Discard changes");
  assert.equal(f.find("textarea").props.value, writing.content);
  assert.equal(f.applied.length, 0);
  await f.change("textarea", () => true, edited);
  await f.click("Apply draft");
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].content, edited);
  assert.match(f.text(), /Draft applied in this tab/);
  await f.click("Open in Canvas");
  assert.deepEqual(f.opened, [[edited, "writing", "Working note"]]);
});

test("code remains editable literal text with language, whitespace and no executable markup", async () => {
  const code = "<script>window.shouldNeverRun = true</script>\n\treturn 1;\n";
  const f = fixture({ ...writing, type: "code", language: "javascript", content: code });
  await f.flush();
  assert.equal(f.find("textarea").props.value, code);
  assert.equal(f.find("textarea").props.spellCheck, false);
  assert.match(f.text(), /javascript code/);
  assert.ok(f.nodes().every((node) => !node.props?.dangerouslySetInnerHTML));
  await f.change("textarea", () => true, `${code}\n`);
  await f.click("Apply draft");
  await f.click("Open in Canvas");
  assert.deepEqual(f.opened, [[`${code}\n`, "code", "Working note"]]);
});

test("date drafts reject nonexistent and out-of-range days before apply or workspace handoff", async () => {
  const f = fixture({
    version: 1,
    type: "date",
    title: "Review date",
    value: "2026-10-21",
    min: "2026-10-01",
    max: "2026-10-31",
  });
  await f.flush();
  for (const invalid of ["2026-02-30", "2026-11-01"]) {
    await f.change("input", (n) => n.props.type === "date", invalid);
    assert.equal(f.find("button", (n) => n.props.children === "Apply draft").props.disabled, true);
    assert.equal(
      f.find("button", (n) => n.props.children === "Open workspace").props.disabled,
      true,
    );
    assert.equal(f.applied.length, 0);
  }
  await f.change("input", (n) => n.props.type === "date", "2026-10-24");
  await f.click("Apply draft");
  assert.equal(f.applied[0].value, "2026-10-24");
  const opener = { focus() {} };
  f.find("button", (n) => n.props.children === "Open workspace").props.onClick({
    currentTarget: opener,
  });
  await f.flush();
  assert.equal(f.workspaces[0][0].value, "2026-10-24");
  assert.equal(f.workspaces[0][1], opener);
});

test("timeline status reflects actual edits, invalid ranges cannot apply, and milestones are editable", async () => {
  const f = fixture({
    version: 1,
    type: "timeline",
    title: "Release plan",
    items: [
      { id: "one", title: "Review", start: "2026-10-21", end: "2026-10-23", status: "planned" },
    ],
  });
  await f.flush();
  assert.match(f.text(), /0 of 1 milestones complete/);
  await f.change("Select", () => true, "done");
  assert.match(f.text(), /1 of 1 milestones complete/);
  await f.change(
    "input",
    (n) => n.props["aria-label"] === "Start date for milestone 1",
    "2026-10-24",
  );
  assert.equal(f.find("button", (n) => n.props.children === "Apply draft").props.disabled, true);
  await f.change(
    "input",
    (n) => n.props["aria-label"] === "Start date for milestone 1",
    "2026-10-21",
  );
  await f.click("Add milestone");
  assert.match(f.text(), /1 of 2 milestones complete/);
  await f.click("Apply draft");
  assert.equal(f.applied[0].items.length, 2);
  assert.equal(f.applied[0].items[0].status, "done");
  await f.click("Remove milestone 2");
  await f.click("Discard changes");
  assert.match(f.text(), /1 of 2 milestones complete/);
});

const board = {
  version: 1,
  type: "board",
  title: "Brainstorm",
  columns: [
    { id: "ideas", title: "Ideas" },
    { id: "chosen", title: "Chosen" },
  ],
  cards: [
    { id: "first", title: "First", columnId: "ideas" },
    { id: "second", title: "Second", columnId: "ideas" },
  ],
};
test("board cards move by keyboard controls, reorder and add without any external save", async () => {
  const f = fixture(board);
  await f.flush();
  await f.click("Move Second up");
  await f.change(
    "Select",
    (n) => n.props.children.some((child) => child.props.id?.endsWith("-first-column")),
    "chosen",
  );
  await f.click("Add idea to Chosen");
  assert.equal(f.applied.length, 0);
  await f.click("Apply draft");
  assert.equal(f.applied.length, 1);
  const applied = f.applied[0];
  assert.equal(applied.cards[0].id, "second");
  assert.equal(applied.cards.find((card) => card.id === "first").columnId, "chosen");
  assert.equal(applied.cards.length, 3);
  assert.equal(new Set(applied.cards.map((card) => card.id)).size, 3);
  assert.match(f.text(), /Draft applied in this tab/);
});

test("expanded workspace emits only explicit applied changes and retains the last applied draft on discard", async () => {
  const f = fixture(writing, { expanded: true });
  await f.flush();
  assert.equal(f.applied.length, 0);
  await f.change("textarea", () => true, "Applied version");
  await f.click("Apply draft");
  await f.change("textarea", () => true, "Unapplied work");
  await f.click("Discard changes");
  assert.equal(f.find("textarea").props.value, "Applied version");
  assert.equal(f.applied.length, 1);
  const separate = fixture(writing);
  await separate.flush();
  assert.equal(separate.find("textarea").props.value, writing.content);
  assert.equal(separate.applied.length, 0);
});
