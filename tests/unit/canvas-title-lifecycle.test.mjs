import test from "node:test";
import assert from "node:assert/strict";
import { loadUiModule, createHookHarness, deferred, settle } from "../helpers/ui-state-harness.mjs";
import * as client from "../../src/lib/collaboration-client.mjs";
function fixture() {
  const h = createHookHarness(),
    requests = [];
  let actor = "A";
  const request = (owner, operation, data) => {
    const d = deferred();
    requests.push({ ...d, owner, operation, data });
    return d.promise;
  };
  const { useCanvasCollaboration } = loadUiModule(
    "src/lib/use-canvas-collaboration.ts",
    {
      react: h.react,
      "./collaboration": {
        collaborationRequest: request,
        parseCanvasSnapshot: (v, owner) => {
          if (v.document.private_owner_id !== owner) throw new client.CollaborationError("42501");
          return v;
        },
        useCollaborationPresence: () => ({}),
      },
      "./collaboration-client.mjs": client,
    },
    { AbortController },
  );
  const render = () =>
    h.render(() =>
      useCanvasCollaboration({
        open: true,
        actorId: actor,
        chatId: "chat",
        messageId: "message",
        initialContent: "body",
      }),
    );
  return { render, requests, setActor: (v) => (actor = v) };
}
const snapshot = (revision = 1, title = "", owner = "A") => ({
  document: {
    id: "doc",
    chat_id: "chat",
    message_id: "message",
    private_owner_id: owner,
    project_id: null,
    revision,
    title,
    content: "body",
    comment_epoch: 0,
  },
  canEdit: true,
  comments: [],
  versions: [],
  deletedCommentIds: [],
});
test("title acknowledgement advances shared Canvas CAS for the next body write; failed save retains revision", async () => {
  const f = fixture();
  f.render();
  f.requests[0].resolve(snapshot());
  await settle();
  const save = f.render().saveTitle("new", "mutation");
  assert.equal(f.requests[1].operation, "save_title");
  assert.equal(f.requests[1].data.expectedRevision, 1);
  f.requests[1].reject(Error("offline"));
  await assert.rejects(save);
  const retry = f.render().saveTitle("new", "mutation");
  assert.deepEqual(f.requests[2].data, f.requests[1].data);
  f.requests[2].resolve(snapshot(2, "new"));
  await retry;
  const body = f.render().save("next body");
  assert.equal(f.requests[3].data.expectedRevision, 2);
  assert.equal(f.requests[3].data.title, undefined);
  f.requests[3].resolve({
    ...snapshot(3, "new"),
    document: { ...snapshot(3, "new").document, content: "next body" },
  });
  await body;
  assert.equal(f.render().snapshot.document.title, "new");
});
test("late title save cannot publish an old principal snapshot after account switch", async () => {
  const f = fixture();
  f.render();
  f.requests[0].resolve(snapshot());
  await settle();
  const pending = f.render().saveTitle("A secret", "mutation");
  f.setActor("B");
  assert.equal(f.render().snapshot, null);
  f.requests[1].resolve(snapshot(2, "A secret"));
  await assert.rejects(pending);
  assert.equal(f.render().snapshot, null);
  f.requests[2].resolve(snapshot(1, "B title", "B"));
  await settle();
  assert.equal(f.render().snapshot.document.title, "B title");
});
