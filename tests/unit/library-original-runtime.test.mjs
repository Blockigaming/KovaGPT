import assert from "node:assert/strict";
import test from "node:test";
import {
  publishOriginalLibraryDocument,
  downloadOriginalLibraryDocument,
  deleteOriginalLibraryDocument,
} from "../../src/lib/library-original-files.server.mjs";
import {
  validateOriginalDocument,
  originalDocumentSha256,
} from "../../src/lib/library-original-policy.mjs";
import { createLibraryAttachmentAutoSaver } from "../../src/lib/library-attachment-auto-save.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  gen = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const bytes = new TextEncoder().encode("%PDF-1.7 original private fixture"),
    sha = await originalDocumentSha256(bytes);
  const input = {
    id,
    name: "Original.pdf",
    contentType: "application/pdf",
    bytes,
    text: "Extracted private text",
  };
  const state = {
    row: {
      id,
      owner_id: owner,
      generation: gen,
      storage_path: `${owner}/${gen}.pdf`,
      file_name: input.name,
      mime_type: input.contentType,
      size_bytes: bytes.length,
      sha256: sha,
      state: "pending",
    },
    stored: bytes,
    events: [],
    lostSettlement: false,
    removeError: false,
    revoked: false,
    signOrigin: "https://fixture.supabase.co",
  };
  const result = (value) => ({ abortSignal: () => Promise.resolve(value) });
  const admin = {
    rpc(name, args) {
      state.events.push(name);
      switch (name) {
        case "reserve_library_file_upload":
          assert.equal(args.p_sha256, sha);
          assert.equal(args.p_storage_limit, 500);
          return result({ data: { ...state.row } });
        case "settle_library_file_upload":
          state.row.state = "ready";
          return result(state.lostSettlement ? { error: { message: "timeout" } } : { data: true });
        case "read_library_file":
        case "read_library_file_version":
          return result({
            data:
              state.revoked ||
              state.row.state !== "ready" ||
              args.p_owner !== owner ||
              args.p_generation !== gen
                ? null
                : { ...state.row },
          });
        case "retire_library_file":
          if (args.p_generation !== gen) return result({ data: false });
          if (!args.p_delete && state.row.state === "ready") return result({ data: false });
          state.row.state = "deleting";
          return result({ data: true });
        case "record_account_storage_artifact_cleanup":
          state.row.state = "deleted";
          return result({ data: true });
        default:
          throw new Error(name);
      }
    },
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        abortSignal: () => q,
        maybeSingle: async () => ({ data: { ...state.row } }),
      };
      return q;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "library-files");
        return {
          upload: async (_path, body, options) => {
            state.events.push("upload");
            assert.equal(options.upsert, false);
            assert.deepEqual(body, bytes);
            return {};
          },
          createSignedUrl: async () => ({
            data: {
              signedUrl: `${state.signOrigin}/storage/v1/object/sign/library-files/${state.row.storage_path}?token=fixture`,
            },
          }),
          remove: async () => {
            state.events.push("remove");
            return state.removeError ? { error: { message: "private provider diagnostic" } } : {};
          },
        };
      },
    },
  };
  const options = {
    storageLimit: 500,
    signal: new AbortController().signal,
    supabaseUrl: "https://fixture.supabase.co",
    fetchImpl: async (url, init) => {
      state.events.push("read_bytes");
      assert.equal(init.redirect, "error");
      return new Response(state.stored);
    },
  };
  return { admin, state, input, options };
}
test("original-file policy rejects mismatched types, traversal, oversized bytes and excessive extracted text without truncating", () => {
  const good = {
    id,
    name: "Report.pdf",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-1.7 content"),
    text: "Extracted",
  };
  assert.equal(validateOriginalDocument(good).name, good.name);
  for (const change of [
    { name: "../Report.pdf" },
    { name: "Report.docx" },
    { contentType: "text/html" },
    { bytes: new Uint8Array(10 * 1024 * 1024 + 1) },
    { text: "x".repeat(200001) },
    { bytes: new TextEncoder().encode("<script>evil</script>") },
  ])
    assert.throws(() => validateOriginalDocument({ ...good, ...change }));
});
test("original publication verifies immutable stored bytes before metadata publication and preserves the original name", async () => {
  const { admin, state, input, options } = await fixture();
  const saved = await publishOriginalLibraryDocument(admin, owner, input, options);
  assert.deepEqual(saved, { id, generation: gen });
  assert.ok(state.events.indexOf("reserve_library_file_upload") < state.events.indexOf("upload"));
  assert.ok(
    state.events.indexOf("read_bytes") < state.events.indexOf("settle_library_file_upload"),
  );
  const downloaded = await downloadOriginalLibraryDocument(
    admin,
    owner,
    id,
    gen,
    options.signal,
    options,
  );
  assert.deepEqual(downloaded.bytes, input.bytes);
  assert.equal(downloaded.row.file_name, "Original.pdf");
});
test("lost settlement replies preserve a ready upload and an identical retry does not upload or charge again", async () => {
  const { admin, state, input, options } = await fixture();
  state.lostSettlement = true;
  await assert.rejects(publishOriginalLibraryDocument(admin, owner, input, options));
  assert.equal(state.row.state, "ready");
  state.lostSettlement = false;
  assert.deepEqual(await publishOriginalLibraryDocument(admin, owner, input, options), {
    id,
    generation: gen,
  });
  assert.equal(state.events.filter((event) => event === "upload").length, 1);
});
test("digest mismatch and foreign signing origins cannot publish or leak original document bytes", async () => {
  for (const fail of [
    (state) => (state.stored = new Uint8Array(state.stored.length)),
    (state) => (state.signOrigin = "https://attacker.invalid"),
  ]) {
    const { admin, state, input, options } = await fixture();
    fail(state);
    await assert.rejects(publishOriginalLibraryDocument(admin, owner, input, options));
    assert.equal(state.events.includes("settle_library_file_upload"), false);
    assert.equal(state.row.state, "deleting");
  }
});
test("a revoked original is withheld after download; stale generation deletion never touches Storage", async () => {
  const { admin, state, input, options } = await fixture();
  state.row.state = "ready";
  const transport = {
    ...options,
    fetchImpl: async () => {
      state.revoked = true;
      return new Response(input.bytes);
    },
  };
  await assert.rejects(
    downloadOriginalLibraryDocument(admin, owner, id, gen, options.signal, transport),
  );
  await assert.rejects(deleteOriginalLibraryDocument(admin, owner, id, id, options.signal));
  assert.equal(state.events.includes("remove"), false);
});
test("failed original deletion keeps its metadata and quota obligation until object removal succeeds", async () => {
  const { admin, state, options } = await fixture();
  state.row.state = "ready";
  state.removeError = true;
  await assert.rejects(
    deleteOriginalLibraryDocument(admin, owner, id, gen, options.signal),
    /could not be removed/,
  );
  assert.equal(state.events.includes("record_account_storage_artifact_cleanup"), false);
  assert.equal(state.row.state, "deleting");
  state.removeError = false;
  await deleteOriginalLibraryDocument(admin, owner, id, gen, options.signal);
  assert.ok(
    state.events.lastIndexOf("remove") <
      state.events.indexOf("record_account_storage_artifact_cleanup"),
  );
});
test("document autosave retains the File only in memory, uses the same id on retry, and cannot cross Temporary Chat or account scopes", async () => {
  let scope = { enabled: true, principal: owner },
    fail = true;
  const calls = [],
    retries = [],
    file = new File(["%PDF-1.7 bytes"], "Original.pdf", { type: "application/pdf" });
  const attachment = {
    clientId: id,
    source: "file_upload",
    kind: "text_file",
    status: "complete",
    name: "Original.pdf.extracted.txt",
    textContent: "Extracted text",
  };
  const save = createLibraryAttachmentAutoSaver({
    getScope: () => scope,
    saveImage: () => assert.fail("Unexpected image save"),
    saveText: () => assert.fail("Original replaced with text-only save"),
    saveDocument: async (original, item, originalScope) => {
      calls.push({ original, item, originalScope });
      if (fail) throw new Error("offline");
    },
    onError: (_name, retry) => retries.push(retry),
  });
  const initial = scope;
  await save(attachment, initial, file);
  assert.equal(calls[0].original, file);
  assert.equal(attachment.originalFile, undefined);
  fail = false;
  await retries[0]();
  assert.equal(calls[1].item.clientId, id);
  scope = { enabled: false, principal: owner };
  await save({ ...attachment, clientId: gen }, scope, file);
  assert.equal(calls.length, 2);
  scope = { enabled: true, principal: owner };
  await retries[0]();
  assert.equal(calls.length, 2);
});
