import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import * as client from "../../src/lib/collaboration-client.mjs";
import { createHookHarness, deferred, loadUiModule, settle } from "../helpers/ui-state-harness.mjs";

const ownerA = "22222222-2222-4222-8222-222222222222";
const ownerB = "33333333-3333-4333-8333-333333333333";
const documentA = "44444444-4444-4444-8444-444444444444";
const documentB = "55555555-5555-4555-8555-555555555555";
// Execute the actual schema parser, hook and merge/conflict policy. Only the
// request boundary, presence transport and React scheduling are synthetic.
const { parseCanvasSnapshot } = loadUiModule("src/lib/collaboration.ts", {
  react: {},
  zod: { z },
  "@/integrations/supabase/client": { supabase: { auth: {} } },
  "@/integrations/supabase/config": { SUPABASE_BROWSER_CONFIG: {} },
  "./kova-auth-browser": {},
  "./kova-auth-realtime": {},
  "./collaboration-client.mjs": {
    ...client,
    createCollaborationClient: () => () => assert.fail("Unexpected transport"),
  },
});
const initial = {
  open: true,
  actorId: ownerA,
  chatId: "chat-a",
  messageId: "message-a",
  projectId: null,
  initialContent: "Opening draft",
};
const snapshot = (props = initial, revision = 1, documentId = documentA) => ({
  document: {
    id: documentId,
    private_owner_id: props.actorId,
    project_id: props.projectId,
    chat_id: props.chatId,
    message_id: props.messageId,
    content: `Fixed revision ${revision}`,
    revision,
    comment_epoch: 0,
    updated_at: "2026-10-19T00:00:00Z",
  },
  canEdit: true,
  canManageComments: false,
  deletedCommentIds: [],
  comments: [],
  versions: [{ revision, created_at: "2026-10-19T00:00:00Z" }],
});
function fixture() {
  const hooks = createHookHarness();
  const requests = [];
  let props = { ...initial };
  let current;
  const { useCanvasCollaboration } = loadUiModule(
    "src/lib/use-canvas-collaboration.ts",
    {
      react: hooks.react,
      "./collaboration-client.mjs": client,
      "./collaboration": {
        parseCanvasSnapshot,
        useCollaborationPresence: () => ({ status: "unavailable", peers: 0 }),
        collaborationRequest(actorId, operation, data, signal) {
          const pending = deferred();
          requests.push({ actorId, operation, data, signal, ...pending });
          return pending.promise;
        },
      },
    },
    { AbortController, Error },
  );
  const render = (patch) => {
    if (patch) props = { ...props, ...patch };
    current = hooks.render(useCanvasCollaboration, props);
    return current;
  };
  render();
  return {
    requests,
    render,
    get current() {
      return current;
    },
    get props() {
      return props;
    },
    async flush() {
      await settle();
      return render();
    },
    async load(value = snapshot()) {
      requests.at(-1).resolve(value);
      return this.flush();
    },
    unmount: () => hooks.unmount(),
  };
}

test("late open from an old actor cannot populate the replacement document", async () => {
  const f = fixture();
  const old = f.requests[0];
  f.render({ actorId: ownerB, chatId: "chat-b", messageId: "message-b" });
  assert.equal(old.signal.aborted, true);
  old.resolve(snapshot());
  await f.flush();
  assert.equal(f.current.snapshot, null);
  const replacement = snapshot(f.props, 1, documentB);
  await f.load(replacement);
  assert.equal(f.current.snapshot.document.id, documentB);
  assert.equal(f.current.snapshot.document.private_owner_id, ownerB);
  assert.equal(f.current.adopt(), replacement.document.content);
  f.unmount();
});

test("late save and refetch from a replaced document cannot change current content or conflict state", async () => {
  const f = fixture();
  await f.load();
  const saved = f.current.save("Old local draft");
  const saveRejected = assert.rejects(saved, { code: "cancelled" });
  const saveRequest = f.requests.at(-1);
  const refreshed = f.current.refresh();
  const refreshRequest = f.requests.at(-1);
  f.render({ chatId: "chat-b", messageId: "message-b", initialContent: "Other opening draft" });
  await f.load(snapshot(f.props, 7, documentB));
  saveRequest.resolve(snapshot(initial, 2));
  refreshRequest.resolve(snapshot(initial, 3));
  await Promise.all([saveRejected, refreshed]);
  await f.flush();
  assert.equal(f.current.snapshot.document.id, documentB);
  assert.equal(f.current.snapshot.document.revision, 7);
  assert.equal(f.current.conflict, false);
  assert.equal(f.current.error, null);
  f.unmount();
});

test("out-of-order refreshes cannot regress revisions and adopt pins the current base", async () => {
  const f = fixture();
  await f.load();
  const older = f.current.refresh();
  const olderRequest = f.requests.at(-1);
  const newer = f.current.refresh();
  f.requests.at(-1).resolve(snapshot(initial, 3));
  await newer;
  await f.flush();
  olderRequest.resolve(snapshot(initial, 2));
  await older;
  await f.flush();
  assert.equal(f.current.snapshot.document.revision, 3);
  assert.equal(f.current.conflict, true);
  const count = f.requests.length;
  await assert.rejects(f.current.save("Must not dispatch while conflicted"), { code: "40001" });
  assert.equal(f.requests.length, count);
  assert.equal(f.current.adopt(), "Fixed revision 3");
  f.render();
  assert.equal(f.current.conflict, false);
  const stale = f.current.refresh();
  f.requests.at(-1).resolve(snapshot(initial, 2));
  await stale;
  await f.flush();
  assert.equal(f.current.snapshot.document.revision, 3);
  assert.equal(f.current.conflict, false);
  const save = f.current.save("New draft based on current version");
  assert.equal(f.requests.at(-1).data.expectedRevision, 3);
  f.requests.at(-1).resolve(snapshot(initial, 4));
  await save;
  await f.flush();
  assert.equal(f.current.snapshot.document.revision, 4);
  f.unmount();
});

test("save 40001 triggers an exact refetch, preserves conflict until adopt and never marks the rejected draft saved", async () => {
  const f = fixture();
  await f.load();
  const save = f.current.save("Unsaved local content");
  const rejected = assert.rejects(save, { code: "40001" });
  f.requests.at(-1).reject(new client.CollaborationError("40001"));
  await rejected;
  await f.flush();
  assert.equal(f.current.conflict, true);
  assert.equal(f.current.snapshot.document.content, "Fixed revision 1");
  const refetch = f.requests.at(-1);
  assert.equal(refetch.operation, "get");
  assert.deepEqual({ ...refetch.data }, { documentId: documentA });
  refetch.resolve(snapshot(initial, 2));
  await f.flush();
  assert.equal(f.current.snapshot.document.revision, 2);
  assert.equal(f.current.conflict, true);
  assert.equal(f.current.adopt(), "Fixed revision 2");
  f.render();
  assert.equal(f.current.conflict, false);
  f.unmount();
});

test("late rejected save after actor change does not refetch or flag the new actor", async () => {
  const f = fixture();
  await f.load();
  const saved = f.current.save("Old actor draft");
  const rejected = assert.rejects(saved, { code: "40001" });
  const pending = f.requests.at(-1);
  f.render({ actorId: ownerB, chatId: "chat-b", messageId: "message-b" });
  await f.load(snapshot(f.props, 1, documentB));
  const count = f.requests.length;
  pending.reject(new client.CollaborationError("40001"));
  await rejected;
  await f.flush();
  assert.equal(f.requests.length, count);
  assert.equal(f.current.conflict, false);
  assert.equal(f.current.snapshot.document.private_owner_id, ownerB);
  f.unmount();
});
