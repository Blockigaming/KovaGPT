import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIBRARY_PDF_RESOURCE_REVIEW_OWNER as owner,
  LIBRARY_PDF_RESOURCE_REVIEW_OPTION as option,
  LIBRARY_PDF_RESOURCE_REVIEW_DISCLOSURE as disclosure,
  installLibraryPdfResourceSamples,
  createLibraryPdfResourceReviewHandler,
} from "./library-pdf-resource-review-fixture.mjs";
import { installLibraryDocumentSamples } from "./library-document-review-fixture.mjs";
const origin = "http://127.0.0.1:4189";
const list = {
  operation: "list",
  query: "",
  sort: "newest",
  filter: "all",
  folder: "all",
  favorites: "",
  cursor: null,
};
function fixture() {
  const items = [{ id: "existing", title: "Unchanged existing row" }];
  installLibraryDocumentSamples(items);
  const before = structuredClone(items),
    originals = installLibraryPdfResourceSamples(items);
  let active = true;
  const handler = createLibraryPdfResourceReviewHandler(originals, {
    isActive: () => active,
    functionNames: new Map([
      ["rename", "renameLibrarySavedItem_hash"],
      ["read", "listMyLibrary_hash"],
    ]),
  });
  return {
    items,
    before,
    originals,
    stop: () => {
      active = false;
    },
    async request({
      path,
      method = "GET",
      principal = owner,
      body,
      raw,
      headers = {},
      signal,
      host = origin,
    } = {}) {
      let output;
      const sample = [...originals.values()][0];
      await handler({
        request: () => ({
          url: () =>
            host +
            (path ?? `/api/library/files?id=${sample.item.id}&generation=${sample.generation}`),
          method: () => method,
          headers: () => ({
            "x-kova-owner": principal,
            "content-type": "application/json",
            ...headers,
          }),
          signal: () => signal,
          postData: () => raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        }),
        fallback: async () => {
          output = { fallback: true };
        },
        fulfill: async (value) => {
          output = value;
        },
      });
      return output;
    },
  };
}
test("resource scenario appends only four deterministic fictional records and preserves sealed document samples", () => {
  const f = fixture();
  assert.deepEqual(f.items.slice(0, 3), f.before);
  assert.equal(f.items.length, 7);
  assert.equal(f.originals.size, 4);
  assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
  assert.equal(option.id, "library-pdf-resource-review");
  assert.equal(option.path, "/library");
  assert.match(disclosure, /blank fallback/);
  assert.match(disclosure, /separately authored/);
  assert.match(disclosure, /mutations are denied/);
  const names = [];
  for (const [id, { item, bytes, generation }] of f.originals) {
    assert.equal(item.id, id);
    assert.equal(item.user_id, owner);
    assert.equal(item.content_generation, generation);
    assert.equal(item.original_generation, generation);
    assert.equal(item.metadata.file_bucket, "library-files");
    assert.equal(item.metadata.storage_generation, generation);
    assert.equal(item.content_revision, 1);
    assert.equal(item.file_type, "application/pdf");
    assert.equal(item.file_url, null);
    assert.equal(item.file_size, bytes.length);
    if (item.file_name === "synthetic-all-blank.pdf") {
      assert.equal(item.content_text, "");
      assert.equal(item.content_excerpt, "");
    } else assert.match(item.content_text, /Independently authored synthetic saved text/);
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.metadata));
    assert.deepEqual(
      bytes,
      readFileSync(new URL(`./review-samples/pdf-pages/${item.file_name}`, import.meta.url)),
    );
    names.push(item.file_name);
  }
  assert.deepEqual(names, [
    "synthetic-large-mediabox.pdf",
    "synthetic-101-page-limit.pdf",
    "synthetic-unsupported-cmap.pdf",
    "synthetic-all-blank.pdf",
  ]);
  assert.deepEqual(fixture().items, f.items);
  assert.throws(() => installLibraryPdfResourceSamples(f.items), /Fresh synthetic/);
  assert.deepEqual(f.items.slice(0, 3), f.before);
});
test("original and retained detail responses use exact bytes and generations, without inventing history", async () => {
  const f = fixture();
  for (const [id, sample] of f.originals) {
    const query = `?id=${id}&generation=${sample.generation}`;
    const original = await f.request({ path: `/api/library/files${query}` });
    assert.equal(original.status, 200);
    assert.equal(original.contentType, "application/pdf");
    assert.equal(original.headers["Cache-Control"], "no-store");
    assert.deepEqual(original.body, sample.bytes);
    const detail = await f.request({ path: `/api/library/items${query}` });
    assert.deepEqual(detail.json, sample.item);
    assert.deepEqual(
      (await f.request({ path: `/api/library/items${query}&revision=1` })).json,
      sample.item,
    );
    assert.deepEqual((await f.request({ path: `/api/library/items${query}&history=1` })).json, {
      supported: false,
      versions: [],
    });
    assert.equal((await f.request({ path: `/api/library/items${query}&revision=2` })).status, 404);
    detail.json.content_text = "Untrusted caller mutation";
    original.body.fill(0);
    sample.bytes.fill(0);
    const retainedText = (await f.request({ path: `/api/library/items${query}` })).json
      .content_text;
    if (sample.item.file_name === "synthetic-all-blank.pdf") assert.equal(retainedText, "");
    else assert.match(retainedText, /Independently authored/);
    assert.equal(
      (await f.request({ path: `/api/library/files${query}` })).body.subarray(0, 4).toString(),
      "%PDF",
    );
  }
});
test("owner, active session, abort, origin, strict query and generation boundaries reject reads", async () => {
  const f = fixture(),
    [one, two] = [...f.originals.values()];
  assert.equal((await f.request({ principal: "another-owner" })).status, 401);
  assert.equal(
    (await f.request({ principal: undefined, headers: { "x-kova-owner": undefined } })).status,
    401,
  );
  assert.equal((await f.request({ signal: AbortSignal.abort() })).status, 499);
  assert.equal((await f.request({ host: "https://example.invalid" })).status, 400);
  for (const path of [
    `/api/library/files?id=${one.item.id}&generation=${one.generation}&extra=1`,
    `/api/library/files?id=${one.item.id}&id=${two.item.id}&generation=${one.generation}`,
    `/api/library/files?id=${one.item.id}&generation=${one.generation}&generation=${one.generation}`,
    `/api/library/files?id=${one.item.id}&generation=${one.generation}&history=1`,
    `/api/library/files?id=${one.item.id}&generation=${one.generation}#bad`,
    `/api/library/files?id=${one.item.id}`,
    `/api/library/items?id=${one.item.id}&generation=${one.generation}&history=1&revision=1`,
    `/api/library/items?id=${one.item.id}&generation=${one.generation}&revision=0`,
  ])
    assert.equal((await f.request({ path })).status, 400, path);
  assert.equal((await f.request({ body: {} })).status, 400);
  assert.equal(
    (await f.request({ path: `/api/library/files?id=${one.item.id}&generation=${two.generation}` }))
      .status,
    404,
  );
  assert.equal(
    (await f.request({ path: `/api/library/items?id=${one.item.id}&generation=${two.generation}` }))
      .status,
    404,
  );
  f.stop();
  assert.equal((await f.request()).status, 401);
  assert.equal(
    (await f.request({ path: "/api/library/items", method: "POST", body: list })).status,
    401,
  );
});
test("every Library write surface is denied without mutations, including server functions and direct storage", async () => {
  const f = fixture(),
    before = structuredClone(f.items);
  for (const path of [
    "/api/library/files",
    "/api/library/items",
    "/api/library/folders",
    "/api/library/bulk-move",
    "/_serverFn/rename",
    "/_serverFn/unknown",
    "/rest/v1/user_library_items",
    "/rest/v1/rpc/replace_library_text",
    "/storage/v1/object/library-files/sample",
  ]) {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD"])
      assert.equal(
        (
          await f.request({
            path,
            method,
            body: { operation: "replace_text", text: "Synthetic rejected edit" },
          })
        ).status,
        405,
        `${method} ${path}`,
      );
  }
  assert.equal((await f.request({ path: "/_serverFn/rename" })).status, 405);
  assert.deepEqual(f.items, before);
  assert.deepEqual(fixture().items, before);
});
test("only the finite POST list read falls back; malformed, oversized and mutation payloads remain blocked", async () => {
  const f = fixture();
  const request = (extra) =>
    f.request({ path: "/api/library/items", method: "POST", body: list, ...extra });
  assert.deepEqual(await request(), { fallback: true });
  assert.deepEqual(await request({ body: { ...list, filter: "documents", query: "Synthetic" } }), {
    fallback: true,
  });
  assert.equal((await request({ body: { ...list, id: "injected" } })).status, 400);
  assert.equal((await request({ body: { ...list, cursor: "{}" } })).status, 400);
  assert.equal((await request({ body: { ...list, favorites: "malformed" } })).status, 400);
  assert.equal((await request({ body: { ...list, query: "a".repeat(201) } })).status, 400);
  assert.equal((await request({ body: { ...list, operation: "replace_text" } })).status, 405);
  assert.equal((await request({ raw: "{" })).status, 400);
  assert.equal((await request({ raw: "a".repeat(8193) })).status, 413);
  assert.equal((await request({ headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await request({ path: "/api/library/items?extra=1" })).status, 400);
  assert.deepEqual(await f.request({ path: "/api/unrelated" }), { fallback: true });
  assert.deepEqual(await f.request({ path: "/_serverFn/read" }), { fallback: true });
  const existing = f.items[1],
    query = `?id=${existing.id}&generation=${existing.content_generation}`;
  assert.deepEqual(await f.request({ path: `/api/library/items${query}` }), { fallback: true });
  assert.equal((await f.request({ path: `/api/library/files${query}` })).status, 404);
});

test("fixed four-record identity is required; blank original remains independent of empty saved text", async () => {
  const f = fixture();
  const blank = [...f.originals.values()].find(
    ({ item }) => item.file_name === "synthetic-all-blank.pdf",
  );
  assert.ok(blank);
  const query = `?id=${blank.item.id}&generation=${blank.generation}`;
  assert.equal((await f.request({ path: `/api/library/items${query}` })).json.content_text, "");
  assert.deepEqual((await f.request({ path: `/api/library/files${query}` })).body, blank.bytes);
  assert.match(disclosure, /valid two-page blank original with empty saved text/);
  const options = { isActive: () => true };
  assert.throws(
    () => createLibraryPdfResourceReviewHandler(new Map([...f.originals].slice(0, 3)), options),
    /fixed resource samples/,
  );
  const foreign = new Map(f.originals);
  const original = foreign.get(blank.item.id);
  foreign.set(blank.item.id, { ...original, item: { ...original.item, user_id: "foreign" } });
  assert.throws(
    () => createLibraryPdfResourceReviewHandler(foreign, options),
    /fixed resource samples/,
  );
});
