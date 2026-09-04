import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isPrivateLibraryImagePath,
  resolveLibraryImageUrl,
} from "../../src/lib/library-image-url.ts";
import { safeImageUrl } from "../../src/lib/safe-image-url.ts";
import { removePrivateLibraryImage } from "../../src/lib/library-storage-policy.ts";

const VALID_DATA_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const PRIVATE_IMAGE_PATH =
  "123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001.png";

test("generated image sources accept safe raster data URLs and reject active or malformed data", () => {
  assert.equal(safeImageUrl(VALID_DATA_IMAGE), VALID_DATA_IMAGE);
  assert.equal(
    safeImageUrl("https://images.openai.com/generated.png"),
    "https://images.openai.com/generated.png",
  );
  assert.equal(safeImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(safeImageUrl("data:text/html;base64,PHNjcmlwdD4="), null);
  assert.equal(safeImageUrl("data:image/png;base64,not valid base64"), null);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
});

test("private Library image paths use the signer while public image URLs bypass it", async () => {
  let calls = 0;
  const signedUrl = "https://project.supabase.co/storage/v1/object/sign/library-images/image.png";
  const sign = async (id) => {
    calls += 1;
    assert.equal(id, "123e4567-e89b-42d3-a456-426614174002");
    return { url: signedUrl };
  };

  assert.equal(isPrivateLibraryImagePath(PRIVATE_IMAGE_PATH), true);
  assert.equal(
    await resolveLibraryImageUrl(
      { id: "123e4567-e89b-42d3-a456-426614174002", file_url: PRIVATE_IMAGE_PATH },
      sign,
    ),
    signedUrl,
  );
  assert.equal(calls, 1);

  const publicUrl = "https://cdn.openai.com/generated.png";
  assert.equal(
    await resolveLibraryImageUrl(
      { id: "123e4567-e89b-42d3-a456-426614174002", file_url: publicUrl },
      sign,
    ),
    publicUrl,
  );
  assert.equal(calls, 1);
});

test("Library image signing rejects unsafe signer output and does not sign arbitrary strings", async () => {
  let calls = 0;
  const unsafeSign = async () => {
    calls += 1;
    return { url: "javascript:alert(1)" };
  };

  assert.equal(
    await resolveLibraryImageUrl(
      { id: "123e4567-e89b-42d3-a456-426614174002", file_url: PRIVATE_IMAGE_PATH },
      unsafeSign,
    ),
    null,
  );
  assert.equal(calls, 1);
  assert.equal(
    await resolveLibraryImageUrl(
      { id: "123e4567-e89b-42d3-a456-426614174002", file_url: "not/a/storage/object" },
      unsafeSign,
    ),
    null,
  );
  assert.equal(calls, 1);
});

test("Library metadata deletion cannot pass a failed private-object removal", async () => {
  const calls = [];
  assert.equal(
    await removePrivateLibraryImage(PRIVATE_IMAGE_PATH, async (paths) => {
      calls.push(paths);
      return { error: null };
    }),
    true,
  );
  assert.deepEqual(calls, [[PRIVATE_IMAGE_PATH]]);

  await assert.rejects(
    () =>
      removePrivateLibraryImage(PRIVATE_IMAGE_PATH, async () => ({
        error: { message: "storage unavailable" },
      })),
    /library_image_storage_remove_failed/u,
  );

  assert.equal(
    await removePrivateLibraryImage("https://cdn.openai.com/legacy.png", async () => {
      throw new Error("public URLs must not be sent to private Storage");
    }),
    false,
  );
});

test("Images and Library routes retain the durable image-pipeline wiring", async () => {
  const [images, library, libraryFunctions, imageFunctions] = await Promise.all([
    readFile("src/routes/images.tsx", "utf8"),
    readFile("src/routes/library.tsx", "utf8"),
    readFile("src/lib/library.functions.ts", "utf8"),
    readFile("src/lib/library-images.functions.ts", "utf8"),
  ]);

  assert.match(images, /useServerFn\(saveImageToLibrary\)/);
  assert.match(images, /safeImageUrl\(data\.imageUrl\)/);
  assert.match(images, /imageUrl: item\.imageUrl/);
  assert.match(images, /prompt: item\.prompt/);
  assert.match(imageFunctions, /readResponseBytesBounded\(res, MAX_BYTES\)/);
  assert.doesNotMatch(imageFunctions, /res\.arrayBuffer\(\)/);
  assert.doesNotMatch(images, /saveToLibrary/);

  assert.match(library, /getLibraryImageUrl\(\{ data: \{ id \} \}\)/);
  assert.match(library, /resolveLibraryImageUrl/);
  assert.match(library, /<LibraryImageDownloadAction item=\{item\} \/>/);
  assert.match(library, /<LibraryImageMedia item=\{item\}/);
  assert.match(library, /onError=\{image\.retry\}/);
  assert.doesNotMatch(library, /src=\{item\.file_url!?\}/);
  assert.doesNotMatch(library, /src=\{visiblePreviewItem\.file_url!?\}/);

  for (const source of [libraryFunctions, imageFunctions]) {
    const removeAt = source.indexOf("await removePrivateLibraryImage");
    const deleteAt = source.indexOf('.from("user_library_items")', removeAt);
    assert.ok(
      removeAt >= 0 && deleteAt > removeAt,
      "Storage removal must precede metadata deletion",
    );
    assert.match(source, /if \(lookupError\)/u);
  }
});
