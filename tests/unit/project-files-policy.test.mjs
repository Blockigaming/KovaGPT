import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProjectFile,
  normalizeProjectFileIdentity,
  MAX_PROJECT_FILE_BYTES,
  normalizeProjectFileName,
  ProjectFileInputError,
  readProjectFileBody,
} from "../../src/lib/project-files-policy.mjs";

test("normalizes project filenames without allowing path components", () => {
  assert.equal(normalizeProjectFileName("../report\u0000.md"), "_report_.md");
  assert.throws(
    () => normalizeProjectFileName(".".repeat(20)),
    (error) => error instanceof ProjectFileInputError && error.code === "invalid_file_name",
  );
});

test("sniffs supported image bytes instead of trusting names or MIME headers", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(
    inspectProjectFile({ bytes: png, fileName: "payload.txt", requestedKind: "image" }),
    {
      name: "payload.txt",
      kind: "image",
      mimeType: "image/png",
      extension: "png",
    },
  );
  assert.throws(
    () => inspectProjectFile({ bytes: png, fileName: "payload.png", requestedKind: "file" }),
    (error) =>
      error instanceof ProjectFileInputError && error.code === "file_kind_does_not_match_content",
  );
  assert.throws(
    () =>
      inspectProjectFile({
        bytes: new TextEncoder().encode("<svg onload=alert(1)>"),
        fileName: "attack.png",
        requestedKind: "image",
      }),
    (error) => error instanceof ProjectFileInputError && error.code === "image_signature_required",
  );
});

test("requires real PDFs, valid UTF-8, and valid JSON", () => {
  assert.equal(
    inspectProjectFile({
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
      fileName: "report.pdf",
      requestedKind: "file",
    }).mimeType,
    "application/pdf",
  );
  assert.throws(
    () =>
      inspectProjectFile({
        bytes: new TextEncoder().encode("not a pdf"),
        fileName: "report.pdf",
        requestedKind: "file",
      }),
    (error) =>
      error instanceof ProjectFileInputError && error.code === "file_content_does_not_match_type",
  );
  assert.throws(
    () =>
      inspectProjectFile({
        bytes: new TextEncoder().encode("{no"),
        fileName: "data.json",
        requestedKind: "file",
      }),
    (error) => error instanceof ProjectFileInputError && error.code === "invalid_json_file",
  );
});

test("bounds declared and streamed request bodies before assembly", async () => {
  await assert.rejects(
    readProjectFileBody(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { "Content-Length": String(MAX_PROJECT_FILE_BYTES + 1) },
        body: new Uint8Array(),
      }),
    ),
    (error) => error instanceof ProjectFileInputError && error.status === 413,
  );

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROJECT_FILE_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  await assert.rejects(
    readProjectFileBody(
      new Request("https://example.invalid", {
        method: "POST",
        body: stream,
        duplex: "half",
      }),
    ),
    (error) => error instanceof ProjectFileInputError && error.code === "file_too_large",
  );
});

test("UUID headers normalize before comparing with canonical database values", () => {
  const upper = "A23E4567-E89B-42D3-A456-426614174000";
  assert.equal(normalizeProjectFileIdentity(upper), upper.toLowerCase());
  assert.equal(normalizeProjectFileIdentity(upper.toLowerCase()), upper.toLowerCase());
  for (const invalid of ["../" + upper, upper + "/object", " " + upper, null]) {
    assert.throws(() => normalizeProjectFileIdentity(invalid), /invalid_project_file_identity/);
  }
});
