import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { sameReviewedMemoryConversation } from "../../src/lib/reviewed-memory-policy.mjs";
const parse = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const route = parse("src/routes/index.tsx"),
  message = parse("src/components/ChatMessage.tsx");
function find(root, match) {
  let result;
  const visit = (node) => {
    if (!result && match(node)) result = node;
    else if (!result) ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(result);
  return result;
}
const init = (root, name) =>
  find(
    root,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(root) === name,
  ).initializer.getText(root);
const compile = (value, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(`return (${value});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(deps));
const owner = "11111111-1111-4111-8111-111111111111";
const conversation = {
  id: "chat-one",
  title: "Review",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: "m1", role: "user", content: "For this answer only" }],
};
const target = { ownerId: owner, generation: 4, conversation };
const scope = {
  reviewedMemoryTarget: target,
  canReviewMemory: true,
  userKey: owner,
  storageGenerationRef: { current: 4 },
  active: conversation,
  sameReviewedMemoryConversation,
};

test("the actual entry retains its original draft snapshot across an identical idle refresh", () => {
  assert.equal(
    compile(init(route, "currentMemoryTarget"), {
      ...scope,
      active: structuredClone(conversation),
    }),
    target,
  );
});
for (const [label, change] of Object.entries({
  owner: { userKey: "other" },
  reset: { storageGenerationRef: { current: 5 } },
  eligibility: { canReviewMemory: false },
  chat: { active: { ...conversation, id: "other" } },
  content: {
    active: { ...conversation, messages: [{ ...conversation.messages[0], content: "changed" }] },
  },
  temporary: { active: { ...conversation, temporary: true } },
}))
  test(`the actual entry invalidates a ${label} change`, () => {
    assert.equal(compile(init(route, "currentMemoryTarget"), { ...scope, ...change }), null);
  });

test("entry is opt-in, resolved, signed-in, paid, non-temporary, and idle", () => {
  const ready = {
    principalReady: true,
    settingsReady: true,
    isLoaded: true,
    isSignedIn: true,
    userKey: owner,
    settings: { rememberAcross: true },
    tier: "plus",
    isStreaming: false,
    active: conversation,
  };
  assert.equal(compile(init(route, "canReviewMemory"), ready), true);
  for (const change of [
    { principalReady: false },
    { settingsReady: false },
    { isLoaded: false },
    { isSignedIn: false },
    { userKey: null },
    { settings: { rememberAcross: false } },
    { tier: "free" },
    { isStreaming: true },
    { active: { ...conversation, temporary: true } },
  ])
    assert.equal(compile(init(route, "canReviewMemory"), { ...ready, ...change }), false);
});
test("opening reviewed memory prevents menu autofocus from fighting the dialog", () => {
  const attribute = find(
    message,
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(message) === "onCloseAutoFocus" &&
      node.getText(message).includes("memoryReviewOpeningRef"),
  );
  const ref = { current: true };
  const close = compile(attribute.initializer.expression.getText(message), {
    memoryReviewOpeningRef: ref,
    responseDraftFocusRef: { current: null },
    studyOpeningRef: { current: false },
  });
  let prevented = 0;
  close({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1);
  assert.equal(ref.current, false);
  close({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1);
});
