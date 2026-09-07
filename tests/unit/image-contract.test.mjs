import assert from "node:assert/strict";
import test from "node:test";
import { png } from "../helpers/image-fixture.mjs";
import {
  normalizeImageRequest,
  imageRequestFields,
} from "../../src/lib/multimodal/image-request-policy.mjs";
import { inspectImageBytes, validateImageResult } from "../../src/lib/multimodal/image-bytes.mjs";
import {
  assertImagePrincipal,
  loadOwnedImageSource,
} from "../../src/lib/multimodal/image-source.server.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const bytes = png(),
    path = `${owner}/${id}.png`;
  const state = {
    row: {
      id,
      user_id: owner,
      item_type: "image",
      file_url: path,
      file_type: "image/png",
      file_size: bytes.length,
      metadata: { storage_generation: id },
    },
    fence: null,
    user: { id: owner, email_confirmed_at: "2026-01-01" },
    url: `https://fixture.supabase.co/storage/v1/object/sign/library-images/${path}?token=private`,
    fetches: 0,
    filters: [],
  };
  const query = (table) => {
    const chain = {
      select: () => chain,
      eq: (key, value) => {
        state.filters.push([table, key, value]);
        return chain;
      },
      abortSignal: () => chain,
      maybeSingle: async () => ({
        data: table === "account_deletion_fences" ? state.fence : state.row,
        error: null,
      }),
    };
    return chain;
  };
  const auth = {
    userId: owner,
    supabaseUser: {
      from: query,
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      storage: {
        from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: state.url } }) }),
      },
    },
    supabaseAdmin: { from: query },
  };
  const options = {
    supabaseUrl: "https://fixture.supabase.co",
    fetchImpl: async (_url, init) => {
      state.fetches++;
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      return new Response(bytes);
    },
  };
  return { state, auth, options };
}
test("image request policy rejects fake edits, variations, unsupported sizes and incompatible output", () => {
  for (const request of [
    { operation: "variation" },
    { operation: "edit", parentImageId: id },
    { parentImageId: id },
    { maskAssetId: id },
    { aspectRatio: "16:9" },
    { size: "1792x1024" },
    { outputFormat: "webp" },
    { transparentBackground: true, outputFormat: "jpeg" },
    { n: 2 },
    { prompt: "x".repeat(2001) },
  ])
    assert.throws(() => normalizeImageRequest({ prompt: "A calm lake", ...request }));
  const edit = normalizeImageRequest(
    {
      prompt: "Turn the sky blue",
      operation: "edit",
      parentImageId: id,
      maskAssetId: id,
      aspectRatio: "3:2",
      quality: "high",
    },
    { editEnabled: true },
  );
  assert.equal(edit.size, "1536x1024");
  assert.equal(edit.parentImageId, id);
  assert.deepEqual(imageRequestFields(edit, "gpt-image-1"), {
    model: "gpt-image-1",
    prompt: "Turn the sky blue",
    size: "1536x1024",
    quality: "high",
    output_format: "png",
    n: 1,
  });
});
test("provider results require one canonical bounded image of the requested format and dimensions", () => {
  const bytes = png(1024, 1024),
    settings = normalizeImageRequest({ prompt: "Lake" });
  assert.equal(
    validateImageResult({ data: [{ b64_json: bytes.toString("base64") }] }, settings).info.width,
    1024,
  );
  for (const result of [
    { data: [{ url: "https://elsewhere.invalid/private" }] },
    { data: [] },
    { data: [{ b64_json: "%%%=" }] },
    { data: [{ b64_json: png().toString("base64") }] },
    { data: [{ b64_json: bytes.subarray(0, 33).toString("base64") }] },
    { data: [{ b64_json: bytes.toString("base64") }, { b64_json: bytes.toString("base64") }] },
  ])
    assert.throws(() => validateImageResult(result, settings));
  assert.throws(() => inspectImageBytes(new Uint8Array(8 * 1024 * 1024 + 1), "image/png"));
});
test("owned image source uses exact current-owner metadata, bounded private bytes and live rechecks", async () => {
  const { state, auth, options } = fixture();
  await assertImagePrincipal(auth);
  const loaded = await loadOwnedImageSource(auth, id, options);
  assert.equal(loaded.info.width, 1);
  assert.equal(state.fetches, 1);
  assert.ok(
    state.filters.some(
      ([table, key, value]) =>
        table === "user_library_items" && key === "user_id" && value === owner,
    ),
  );
  state.row = { ...state.row, metadata: { storage_generation: "new" } };
  await assert.rejects(loaded.recheck(), /no longer available/);
});
test("image source rejects another owner, missing rows, traversal, external signing and oversized metadata before fetching", async () => {
  for (const change of [
    (s) => (s.row = null),
    (s) => (s.row.user_id = id),
    (s) => (s.row.file_url = `${owner}/../secret.png`),
    (s) => (s.row.file_size = 8 * 1024 * 1024 + 1),
    (s) => (s.url = "https://attacker.invalid/image"),
    (s) => (s.url = s.url.replace("library-images/", "library-images/extra/")),
  ]) {
    const { state, auth, options } = fixture();
    change(state);
    await assert.rejects(loadOwnedImageSource(auth, id, options));
    assert.equal(state.fetches, 0);
  }
});
test("fenced, removed and unverified principals cannot consume source bytes; masks need alpha", async () => {
  for (const change of [
    (s) => (s.fence = { user_id: owner }),
    (s) => (s.user.id = id),
    (s) => (s.user.email_confirmed_at = null),
    (s) => (s.user.deleted_at = "2026-09-05"),
    (s) => (s.user.banned_until = "2099-01-01"),
  ]) {
    const { state, auth } = fixture();
    change(state);
    await assert.rejects(assertImagePrincipal(auth));
  }
  const { state, auth, options } = fixture(),
    bytes = png(1, 1, false);
  state.row.file_size = bytes.length;
  await assert.rejects(
    loadOwnedImageSource(auth, id, {
      ...options,
      mask: true,
      fetchImpl: async () => new Response(bytes),
    }),
    /alpha channel/,
  );
});
test("source byte-length drift and aborted reads fail closed", async () => {
  const { state, auth, options } = fixture();
  state.row.file_size++;
  await assert.rejects(loadOwnedImageSource(auth, id, options));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(assertImagePrincipal(auth, controller.signal));
});
