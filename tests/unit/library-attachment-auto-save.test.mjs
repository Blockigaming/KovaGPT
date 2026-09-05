import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createLibraryAttachmentAutoSaver } from "../../src/lib/library-attachment-auto-save.mjs";

const candidate = (overrides = {}) => ({
  clientId: "11111111-1111-4111-8111-111111111111",
  source: "file_upload",
  kind: "image",
  dataUrl: "data:image/png;base64,test",
  name: "image.png",
  status: "complete",
  ...overrides,
});
function setup() {
  let scope = { enabled: true, principal: "user-a" };
  const calls = [];
  const retries = [];
  let action = async (value) => calls.push(value);
  const save = createLibraryAttachmentAutoSaver({
    getScope: () => scope,
    saveImage: (v) => action(v),
    saveText: (v) => action(v),
    onError: (name, retry) => retries.push({ name, retry }),
  });
  return {
    save,
    calls,
    retries,
    setScope: (value) => {
      scope = value;
    },
    getScope: () => scope,
    setAction: (fn) => {
      action = fn;
    },
  };
}

test("completed file uploads persist once with a stable server idempotency key", async () => {
  const state = setup();
  let done;
  state.setAction((value) => {
    state.calls.push(value);
    return new Promise((resolve) => {
      done = resolve;
    });
  });
  const first = state.save(candidate());
  await state.save(candidate());
  assert.equal(state.calls.length, 1);
  done();
  await first;
  await state.save(candidate());
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].data.idempotencyKey, candidate().clientId);
  assert.equal(state.calls[0].data.source, "upload");
});

test("temporary, guest, incomplete, and Library references never auto-save", async () => {
  const state = setup();
  for (const overrides of [
    { status: "failed" },
    { status: "uploading" },
    { source: "library" },
    { clientId: undefined },
    { kind: "library_file" },
  ])
    await state.save(candidate(overrides));
  state.setScope({ enabled: false, principal: "user-a" });
  await state.save(candidate());
  state.setScope({ enabled: true, principal: null });
  await state.save(candidate());
  assert.equal(state.calls.length, 0);
});

test("a failed text save keeps a stable retry and cannot cross a privacy or account transition", async () => {
  const state = setup();
  state.setAction(async () => {
    throw new Error("offline");
  });
  const attachment = candidate({ kind: "text_file", textContent: "private", name: "notes.txt" });
  const originalScope = state.getScope();
  await state.save(attachment);
  assert.equal(state.retries.length, 1);
  state.setAction(async (value) => state.calls.push(value));
  await state.retries[0].retry();
  assert.equal(state.calls[0].data.content_text, "private");
  state.setScope({ enabled: false, principal: "user-a" });
  state.setScope({ enabled: true, principal: "user-a" });
  await state.save(candidate({ clientId: "22222222-2222-4222-8222-222222222222" }), originalScope);
  state.setScope({ enabled: true, principal: "user-b" });
  await state.retries[0].retry();
  assert.equal(state.calls.length, 1);
});

test("composer assigns IDs at file selection and passes its captured privacy scope after each read", () => {
  const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.equal((composer.match(/clientId: crypto.randomUUID\(\)/g) || []).length, 2);
  assert.equal(
    (composer.match(/attachmentAutoSave.save\(completed, readScope\)/g) || []).length,
    2,
  );
  assert.equal(
    (route.match(/saveAttachmentsToLibrary=\{principalReady && !tempChat\}/g) || []).length,
    2,
  );
});
