import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import {
  createImageReviewHandler,
  installImageReview,
  IMAGE_REVIEW_DATA_URL,
  IMAGE_REVIEW_OWNER,
  IMAGE_REVIEW_SOURCE_ID,
} from "../../review-kit/image-review-fixture.mjs";
const names = new Map([
  ["save", "saveImageToLibrary_createServerFn_handler"],
  ["read", "getLibraryImageUrl_createServerFn_handler"],
]);
async function request(review, path, method = "GET", data, server = false) {
  let result;
  const raw = data === undefined ? null : JSON.stringify(server ? toJSON({ data }) : data);
  await review.handler({
    request: () => ({
      url: () => (path.startsWith("http") ? path : `http://127.0.0.1:4189${path}`),
      method: () => method,
      postData: () => raw,
    }),
    fulfill: async (value) => {
      result = value;
    },
    fallback: async () => {
      result = { fallback: true };
    },
  });
  return result;
}
const prompt = { prompt: "An origami bird", aspectRatio: "1:1" };
test("image options, source selection, generate and edit return source-compatible local samples", async () => {
  const review = createImageReviewHandler("image-sample-success", names);
  const options = await request(review, "/api/generate-image?sources=1");
  assert.equal(options.json.editingEnabled, true);
  assert.equal(options.json.variationEnabled, false);
  assert.equal(options.json.images[0].id, IMAGE_REVIEW_SOURCE_ID);
  const generated = await request(review, "/api/generate-image", "POST", prompt);
  assert.equal(generated.json.imageUrl, IMAGE_REVIEW_DATA_URL);
  assert.equal(generated.json.metadata.reviewOnly, true);
  const bytes = Buffer.from(IMAGE_REVIEW_DATA_URL.split(",")[1], "base64");
  assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff");
  const edited = await request(review, "/api/generate-image", "POST", {
    ...prompt,
    operation: "edit",
    parentImageId: IMAGE_REVIEW_SOURCE_ID,
  });
  assert.equal(edited.json.imageUrl, generated.json.imageUrl);
  assert.equal(edited.json.metadata.operation, "edit");
  assert.match(edited.json.metadata.disclosure, /same sample/);
});
test("failure preserves request prompt in captured evidence and creates no gallery/save data", async () => {
  const review = createImageReviewHandler("image-sample-failure", names);
  const result = await request(review, "/api/generate-image", "POST", prompt);
  assert.equal(result.status, 503);
  assert.equal(result.json.imageUrl, undefined);
  assert.equal(review.getItems().length, 1);
  assert.deepEqual(review.requests[0].data, prompt);
  assert.equal(review.requests[0].method, "POST");
  assert.equal(review.requests[0].raw, JSON.stringify(prompt));
});
test("save and read use existing Seroval contracts, local memory only, and Library filters", async () => {
  const review = createImageReviewHandler("image-sample-success", names);
  const save = {
    expectedOwnerId: IMAGE_REVIEW_OWNER,
    title: "Saved sample",
    prompt: prompt.prompt,
    imageUrl: IMAGE_REVIEW_DATA_URL,
  };
  const result = await request(review, "/_serverFn/save", "POST", save, true);
  const id = result.json.result.id;
  assert.match(id, /^99999999-/);
  const listed = await request(review, "/api/library/items", "POST", {
    operation: "list",
    query: "Saved sample",
    filter: "images",
  });
  assert.equal(listed.json.items.length, 1);
  assert.equal(listed.json.items[0].id, id);
  assert.equal(listed.json.items[0].source, "images");
  const detail = await request(review, `/api/library/items?id=${id}`);
  assert.equal(detail.json.file_url, IMAGE_REVIEW_DATA_URL);
  const signed = await request(review, "/_serverFn/read", "POST", { id }, true);
  assert.equal(signed.json.result.url, IMAGE_REVIEW_DATA_URL);
  assert.equal(
    (
      await request(review, "/api/library/items", "POST", {
        operation: "list",
        filter: "documents",
      })
    ).json.items.length,
    0,
  );
  assert.equal(createImageReviewHandler("image-sample-success", names).getItems().length, 1);
});
test("invalid edits, masks, methods, owners and external image URLs fail closed", async () => {
  const review = createImageReviewHandler("image-sample-success", names);
  for (const data of [
    { ...prompt, prompt: " " },
    { ...prompt, aspectRatio: "16:9" },
    { ...prompt, operation: "edit", parentImageId: "unknown" },
    {
      ...prompt,
      operation: "edit",
      parentImageId: IMAGE_REVIEW_SOURCE_ID,
      maskAssetId: IMAGE_REVIEW_SOURCE_ID,
    },
  ])
    assert.equal((await request(review, "/api/generate-image", "POST", data)).status, 400);
  assert.equal((await request(review, "/api/generate-image", "DELETE")).status, 405);
  for (const data of [
    { expectedOwnerId: "wrong", imageUrl: IMAGE_REVIEW_DATA_URL },
    { expectedOwnerId: IMAGE_REVIEW_OWNER, imageUrl: "https://example.com/private.jpg" },
  ])
    assert.equal(
      (
        await request(
          review,
          "/_serverFn/save",
          "POST",
          { title: "Sample", prompt: "Sample", ...data },
          true,
        )
      ).status,
      400,
    );
  assert.equal(
    (await request(review, "/api/library/items", "POST", { operation: "delete" })).status,
    503,
  );
  assert.equal(review.getItems().length, 1);
});
test("routes stay local and install only registers the handler without navigation or provider calls", async () => {
  const review = createImageReviewHandler("image-sample-success", names);
  for (const path of ["https://example.com/api/generate-image", "/api/chat", "/_serverFn/unknown"])
    assert.equal((await request(review, path)).fallback, true);
  let registered;
  const installed = await installImageReview(
    {
      route: async (...args) => {
        registered = args;
      },
    },
    "image-sample-success",
    { functionNames: names },
  );
  assert.equal(registered[0], "**/*");
  assert.equal(registered[1], installed.handler);
  assert.match(installed.disclosure, /No image provider/);
  assert.throws(() => createImageReviewHandler("live"), /Unknown/);
});
