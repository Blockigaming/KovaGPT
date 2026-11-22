import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";

function fixture(count = 1) {
  const harness = createHookHarness();
  const feedback = loadUiModule("src/lib/use-scoped-action-feedback.ts", { react: harness.react });
  let request = deferred();
  const sent = [],
    focus = [];
  const { CanvasComments } = loadUiModule(
    "src/components/CanvasComments.tsx",
    {
      react: harness.react,
      "@/lib/use-scoped-action-feedback": feedback,
      "@/components/ResultCommentDeleteDialog": { ResultCommentDeleteDialog: "Confirmation" },
      "@/lib/collaboration-client.mjs": { resolveCommentAnchor: () => ({ state: "removed" }) },
    },
    {
      Error,
      crypto: { randomUUID: () => "stable-new-comment-id" },
      window: { location: { href: "https://review.invalid/result" } },
    },
  );
  let props = {
    snapshot: {
      document: { id: "doc-a", project_id: null, revision: 1, comment_epoch: 3 },
      canEdit: true,
      canManageComments: false,
      comments: Array.from({ length: count }, (_, index) => ({
        id: `comment-${index}`,
        author_id: "owner-a",
        body: `Comment ${index}`,
        anchor: null,
        created_at: "2026-10-19T00:00:00Z",
      })),
    },
    value: "Saved draft",
    actorId: "owner-a",
    dirty: false,
    selection: () => null,
    onSelect() {},
    onComment: (payload) => {
      sent.push(payload);
      return request.promise;
    },
    onDelete: () => assert.fail("Deletion requires its confirmation"),
    onOlder: () => {
      sent.push("older-read");
      return request.promise;
    },
  };
  let tree;
  const render = () => {
    tree = harness.render(CanvasComments, props);
    const input = elements(tree, (node) => node.type === "textarea")[0];
    input.props.ref.current = { focus: () => focus.push("input") };
    elements(tree, (node) => node.type === "h2")[0].props.ref.current = {
      focus: () => focus.push("heading"),
    };
    return tree;
  };
  const button = (label) =>
    elements(tree, (node) => node.type === "button" && text(node).trim() === label)[0];
  const input = () => elements(tree, (node) => node.type === "textarea")[0];
  render();
  return {
    render,
    button,
    input,
    sent,
    focus,
    props,
    get tree() {
      return tree;
    },
    get request() {
      return request;
    },
    next() {
      request = deferred();
    },
    unmount: harness.unmount,
  };
}

test("durable comment has persistent associated label, retained focus and original idempotency across failure retry", async () => {
  const f = fixture();
  const label = elements(f.tree, (node) => node.type === "label")[0];
  assert.equal(label.props.htmlFor, f.input().props.id);
  f.input().props.onChange({ target: { value: "Keep this comment" } });
  f.render();
  const add = f.button("Add comment");
  assert.equal(add.props.variant, "default");
  const primitive = readFileSync("src/components/ui/button.tsx", "utf8");
  assert.match(primitive, /default: "h-9 /);
  assert.ok(primitive.includes("[@media(pointer:coarse)]:min-h-11"));
  add.props.onClick();
  add.props.onClick();
  assert.deepEqual(f.focus, ["input", "input"]);
  assert.equal(f.sent.length, 1);
  f.request.reject(new Error("Lost response"));
  await settle();
  f.render();
  assert.equal(f.input().props.value, "Keep this comment");
  assert.match(text(f.tree), /Your draft is preserved/);
  f.next();
  f.button("Add comment").props.onClick();
  assert.equal(f.sent[0].commentId, f.sent[1].commentId);
  assert.equal(f.sent[1].commentEpoch, 3);
  f.input().props.onChange({ target: { value: "A later unsent comment" } });
  f.render();
  f.request.resolve();
  await settle();
  f.render();
  assert.equal(
    f.input().props.value,
    "A later unsent comment",
    "completion cannot clear later typing",
  );
  assert.doesNotMatch(text(f.tree), /Lost response/);
});

test("older-comment read moves focus to retained heading before disabling/removing its trigger", async () => {
  const f = fixture(100);
  f.button("Load older comments").props.onClick();
  assert.deepEqual(f.focus, ["heading"]);
  assert.deepEqual(f.sent, ["older-read"]);
  f.request.resolve();
  await settle();
  f.render();
  assert.equal(f.button("Load older comments").props.disabled, false);
});

test("comment rows open review without deleting and only caller remount keys isolate owner/document drafts", () => {
  const f = fixture();
  const trigger = { id: "comment-delete-trigger" };
  f.button("Delete comment").props.onClick({ currentTarget: trigger });
  f.render();
  const dialog = elements(f.tree, (node) => node.type === "Confirmation")[0];
  assert.equal(dialog.props.target.id, "comment-0");
  assert.equal(dialog.props.target.trigger, trigger);
  assert.deepEqual(f.sent, []);
  const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
  assert.match(
    editor,
    /<CanvasComments\s+key=\{JSON\.stringify\(\[userKey, remoteSnapshot\.document\.id\]\)\}/,
  );
  assert.match(editor, /commentInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});
