import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as metadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import * as office from "../../src/lib/document-extraction/office.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const pdf = {
  pageCount: 2,
  pages: [
    { pageNumber: 1, status: "extracted", text: "Text" },
    { pageNumber: 2, status: "no_text" },
  ],
};
const success = {
  kind: "document-extraction-result",
  ok: true,
  text: metadata.pdfDocumentText(pdf),
  note: "PDF text",
  pdf,
};
const emptyPdf = { pageCount: 1, pages: [{ pageNumber: 1, status: "no_text" }] };

function clientFixture() {
  const workers = [],
    timers = new Map();
  let sequence = 0;
  const source = readFileSync("src/lib/document-extraction/client.ts", "utf8").replaceAll(
    "import.meta.url",
    '"https://local.test/client.js"',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.equal(name, "./pdf-metadata.mjs");
      return metadata;
    },
    URL,
    TextEncoder,
    DOMException,
    Error,
    Worker: class {
      terminated = 0;
      constructor() {
        workers.push(this);
      }
      terminate() {
        this.terminated++;
      }
      postMessage(message, transfer) {
        this.posted = message;
        this.transfer = transfer;
      }
    },
    setTimeout: (callback, ms) => {
      assert.equal(ms, 15_000);
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return { workers, timers, extract: exports.extractDocumentFile };
}
const file = (name = "sample.pdf") => ({
  name,
  size: 8,
  arrayBuffer: async () => new ArrayBuffer(8),
});
const tick = () => new Promise(setImmediate);

test("client ignores PDF transport messages, validates metadata and terminates exactly on its result", async () => {
  const f = clientFixture(),
    promise = f.extract(file());
  await tick();
  const worker = f.workers[0];
  assert.equal(worker.transfer[0], worker.posted.bytes);
  worker.onmessage({ data: { sourceName: "main", targetName: "worker", action: "ready" } });
  assert.equal(worker.terminated, 0);
  assert.equal(f.timers.size, 1);
  worker.onmessage({ data: success });
  assert.deepEqual(await promise, { text: success.text, note: success.note, pdf });
  assert.equal(worker.terminated, 1);
  assert.equal(f.timers.size, 0);
});

test("client rejects invalid metadata, missing PDF metadata and text overflows without losing worker cleanup", async () => {
  for (const result of [
    { ...success, pdf: undefined },
    { ...success, pdf: { ...pdf, pageCount: 1000 } },
    { ...success, text: "Invented split" },
    { ...success, text: "x".repeat(80_001) },
    { ...success, note: "x".repeat(2_001) },
  ]) {
    const f = clientFixture(),
      promise = f.extract(file());
    const check = assert.rejects(promise, /Document extraction failed/);
    await tick();
    f.workers[0].onmessage({ data: result });
    await check;
    assert.equal(f.workers[0].terminated, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("all-empty PDF error carries validated page observations; incomplete or success-shaped error metadata is dropped", async () => {
  for (const [observations, retained] of [
    [emptyPdf, true],
    [{ pageCount: 2, pages: [] }, false],
    [pdf, false],
  ]) {
    const f = clientFixture(),
      promise = f.extract(file());
    const check = assert.rejects(promise, (error) => {
      assert.equal(error instanceof metadata.PdfTextUnavailableError, retained);
      assert.equal(Boolean(error.pdf), retained);
      return true;
    });
    await tick();
    f.workers[0].onmessage({
      data: { kind: "document-extraction-result", ok: false, error: "No text", pdf: observations },
    });
    await check;
    assert.equal(f.workers[0].terminated, 1);
  }
});

test("timeout, abort and worker failure terminate extraction while pre-abort and oversized files never start it", async () => {
  for (const action of ["timeout", "abort", "worker error"]) {
    const f = clientFixture(),
      controller = new AbortController();
    const promise = f.extract(file(), controller.signal);
    const check = assert.rejects(
      promise,
      action === "timeout" ? /too long/ : action === "abort" ? /Aborted/ : /unavailable/,
    );
    await tick();
    if (action === "timeout") [...f.timers.values()][0]();
    else if (action === "abort") controller.abort();
    else f.workers[0].onerror();
    await check;
    assert.equal(f.workers[0].terminated, 1);
    assert.equal(f.timers.size, 0);
    controller.abort();
    assert.equal(f.workers[0].terminated, 1);
  }
  const f = clientFixture(),
    controller = new AbortController();
  controller.abort();
  let read = false;
  await assert.rejects(
    f.extract(
      {
        ...file(),
        arrayBuffer: () => {
          read = true;
        },
      },
      controller.signal,
    ),
    /Aborted/,
  );
  await assert.rejects(f.extract({ ...file(), size: 10 * 1024 * 1024 + 1 }), /10 MB/);
  assert.equal(read, false);
  assert.equal(f.workers.length, 0);
});

test("Office extraction keeps its bounded text-and-note result without PDF metadata", async () => {
  const f = clientFixture(),
    promise = f.extract(file("sample.docx"));
  await tick();
  f.workers[0].onmessage({
    data: {
      kind: "document-extraction-result",
      ok: true,
      text: "Office text",
      note: "Office note",
    },
  });
  assert.deepEqual(await promise, { text: "Office text", note: "Office note" });
});

test("worker returns structured pages on success and known no-text errors, but never private parser errors", async () => {
  for (const scenario of ["success", "empty", "private"]) {
    const messages = [],
      self = { postMessage: (message) => messages.push(message) };
    loadUiModule(
      "src/lib/document-extraction/document-extraction.worker.ts",
      {
        "./office.mjs": office,
        "./pdf-metadata.mjs": metadata,
        "pdfjs-dist/legacy/build/pdf.worker.mjs": {},
        "pdfjs-dist/legacy/build/pdf.mjs": { getDocument() {} },
        "./pdf": {
          extractPdfDocument: async () => {
            if (scenario === "empty")
              throw Object.assign(new office.DocumentExtractionError("No extractable text"), {
                pdf: emptyPdf,
              });
            if (scenario === "private") throw new Error("PRIVATE XML PAYLOAD");
            return { text: success.text, note: success.note, pdf };
          },
        },
      },
      { self, Uint8Array },
    );
    await self.onmessage({ data: { bytes: new ArrayBuffer(8), extension: "pdf" } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ok, scenario === "success");
    assert.equal(
      messages[0].pdf?.pageCount,
      scenario === "success" ? 2 : scenario === "empty" ? 1 : undefined,
    );
    assert.doesNotMatch(JSON.stringify(messages), /PRIVATE/);
  }
});
