import assert from "node:assert/strict";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  createHistoricalLibraryReviewHandler,
  syntheticReviewPdf,
  installLibraryDocumentSamples,
  createLibraryDocumentReviewHandler,
  LIBRARY_DOCUMENT_REVIEW_OWNER as owner,
} from "./library-document-review-fixture.mjs";

test("bundled original is an actual two-page fictional PDF distinct from extracted text", async () => {
  const task = getDocument({
    data: new Uint8Array(syntheticReviewPdf()),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    enableXfa: false,
  });
  try {
    const doc = await task.promise;
    assert.equal(doc.numPages, 2);
    for (let i = 1; i <= 2; i++) {
      const text = await (await doc.getPage(i)).getTextContent();
      assert.match(
        text.items.map((item) => item.str ?? "").join(" "),
        new RegExp(`Synthetic review page ${i}`),
      );
    }
  } finally {
    await task.destroy();
  }
});

function fixture() {
  const items = [];
  const originals = installLibraryDocumentSamples(items);
  let active = true;
  const handler = createLibraryDocumentReviewHandler(originals, { isActive: () => active });
  return {
    items,
    stop: () => {
      active = false;
    },
    request: async ({ method = "GET", principal = owner, path, signal } = {}) => {
      let output;
      const item = items[0];
      await handler({
        request: () => ({
          url: () =>
            `http://127.0.0.1:4189${path ?? `/api/library/files?id=${item.id}&generation=${item.original_generation}`}`,
          method: () => method,
          headers: () => ({ "x-kova-owner": principal }),
          signal: () => signal,
        }),
        fulfill: async (value) => {
          output = value;
        },
        fallback: async () => {
          output = { fallback: true };
        },
      });
      return output;
    },
  };
}

test("original reader is owner/session/generation-bound and rejects every write", async () => {
  const f = fixture();
  assert.equal(f.items.length, 2);
  for (const item of f.items) {
    assert.equal(item.metadata.file_bucket, "library-files");
    assert.equal(item.metadata.storage_generation, item.original_generation);
  }
  assert.equal((await f.request()).contentType, "application/pdf");
  for (const method of ["POST", "PATCH", "DELETE"])
    assert.equal((await f.request({ method })).status, 405);
  assert.equal((await f.request({ principal: "other" })).status, 401);
  assert.equal(
    (
      await f.request({
        path: `/api/library/files?id=${f.items[0].id}&generation=${f.items[1].original_generation}`,
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.request({ path: "/api/library/files?id=missing&id=duplicate&generation=unknown" }))
      .status,
    400,
  );
  assert.equal((await f.request({ signal: AbortSignal.abort() })).status, 499);
  assert.deepEqual(await f.request({ path: "/api/unrelated" }), { fallback: true });
  f.stop();
  assert.equal((await f.request()).status, 401);
});

test("invalid original is a deliberate contained preview error, with retained extracted text", async () => {
  const f = fixture(),
    item = f.items[1];
  const response = await f.request({
    path: `/api/library/files?id=${item.id}&generation=${item.original_generation}`,
  });
  const task = getDocument({
    data: new Uint8Array(response.body),
    useWorkerFetch: false,
    enableXfa: false,
  });
  try {
    await assert.rejects(task.promise);
  } finally {
    await task.destroy();
  }
  assert.match(item.content_text, /retained extracted text/);
  assert.equal(fixture().items[0].title, "Synthetic two-page document");
});

test("historical identity samples distinguish exact existing, absent and invalid reads", async () => {
  const items = [];
  installLibraryDocumentSamples(items);
  let active = true;
  const handler = createHistoricalLibraryReviewHandler({
    isActive: () => active,
    getItems: () => items,
  });
  const read = async (id, principal = owner, method = "GET") => {
    let result;
    await handler({
      request: () => ({
        url: () =>
          `https://synthetic.invalid/rest/v1/user_library_items?${new URLSearchParams({ select: "id,user_id", user_id: `eq.${principal}`, id: `eq.${id}` })}`,
        method: () => method,
        signal: () => undefined,
      }),
      fulfill: async (value) => {
        result = value;
      },
      fallback: async () => {
        result = { fallback: true };
      },
    });
    return result;
  };
  assert.deepEqual((await read(items[0].id)).json, [{ id: items[0].id, user_id: owner }]);
  assert.deepEqual((await read("dddddddd-dddd-4ddd-8ddd-dddddddddddd")).json, []);
  assert.equal((await read(items[0].id, "other")).status, 400);
  assert.equal((await read(items[0].id, owner, "DELETE")).status, 405);
  active = false;
  assert.equal((await read(items[0].id)).status, 401);
});
