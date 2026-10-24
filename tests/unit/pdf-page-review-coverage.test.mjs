import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { load } from "../helpers/document-writers.mjs";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";
import { reactFixture, nodes } from "../helpers/kova-react-fixture.mjs";
import * as metadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import * as office from "../../src/lib/document-extraction/office.mjs";
import {
  PDF_PAGE_REVIEW_SAMPLES,
  syntheticPdfPageReviewSample,
  syntheticCmapDependentPdf,
  syntheticLargeMediaBoxPdf,
  syntheticPageLimitPdf,
  PDF_RESOURCE_REVIEW_SAMPLES,
} from "../../review-kit/pdf-page-review-samples.mjs";
const { extractPdfDocument } = load("src/lib/document-extraction/pdf.ts");
const previewHelper = load("src/lib/library-document-preview.ts");
const statuses = (pdf) => pdf.pages.map((page) => page.status);
const tick = () => new Promise(setImmediate);
const limits = previewHelper.LIBRARY_PDF_PREVIEW_LIMITS;

async function workerEnvelope(bytes) {
  const messages = [],
    self = { postMessage: (value) => messages.push(value) };
  loadUiModule(
    "src/lib/document-extraction/document-extraction.worker.ts",
    {
      "./office.mjs": office,
      "./pdf-metadata.mjs": metadata,
      "pdfjs-dist/legacy/build/pdf.worker.mjs": {},
      "pdfjs-dist/legacy/build/pdf.mjs": { getDocument },
      "./pdf": { extractPdfDocument },
    },
    { self, Uint8Array },
  );
  await self.onmessage({ data: { bytes: bytes.slice().buffer, extension: "pdf" } });
  assert.equal(messages.length, 1);
  return messages[0];
}
function clientFixture() {
  const workers = [],
    timers = new Map();
  let next = 0;
  const source = readFileSync("src/lib/document-extraction/client.ts", "utf8").replaceAll(
    "import.meta.url",
    '"https://example.invalid/client.js"',
  );
  const exports = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
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
        postMessage(value) {
          this.posted = value;
        }
      },
      setTimeout: (fn, ms) => {
        assert.equal(ms, 15000);
        timers.set(++next, fn);
        return next;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return { workers, timers, extract: exports.extractDocumentFile };
}
function renderPages(pdf) {
  const hooks = createHookHarness();
  const { ComposerPdfPages } = loadUiModule("src/components/ComposerPdfPages.tsx", {
    react: hooks.react,
    "@/lib/document-extraction/pdf-metadata.mjs": metadata,
  });
  return hooks.render(ComposerPdfPages, {
    pdf,
    disabled: true,
    onSelect: () => assert.fail("Unavailable pages cannot be selected"),
  });
}

test("fixed real PDFs reproduce blank, mixed, all-failed and failed-plus-blank statuses through the installed parser", async () => {
  for (const [kind, sample] of Object.entries(PDF_PAGE_REVIEW_SAMPLES)) {
    const first = await syntheticPdfPageReviewSample(kind),
      second = await syntheticPdfPageReviewSample(kind);
    assert.deepEqual(first, second, `${kind} must have deterministic bytes`);
    assert.ok(first.length < 12000);
    assert.doesNotMatch(
      new TextDecoder().decode(first),
      /https?:|\/JavaScript|\/JS\b|\/OpenAction|\/URI\b/,
    );
    if (kind !== "failed-and-blank")
      assert.deepEqual(
        first,
        new Uint8Array(readFileSync(`review-kit/review-samples/pdf-pages/${sample.name}`)),
      );
    if (kind === "mixed") {
      const result = await extractPdfDocument(first.slice(), getDocument);
      assert.deepEqual(statuses(result.pdf), sample.statuses);
      assert.match(result.text, /Synthetic local PDF review/);
      assert.match(result.text, /\[Page 3\]\n\[Text extraction failed for this page\]/);
      assert.equal(metadata.validateDocumentExtractionResult(result, true).pdf.pageCount, 3);
    } else
      await assert.rejects(extractPdfDocument(first.slice(), getDocument), (error) => {
        assert.deepEqual(statuses(error.pdf), sample.statuses);
        assert.match(error.message, kind === "blank" ? /blank or scanned/ : /page reads failed/);
        assert.ok(metadata.validatePdfMetadata(error.pdf));
        assert.doesNotMatch(error.message, /XObject|SyntheticBrokenForm|FormatError/);
        return true;
      });
  }
});

test("real all-failed and failed/blank results cross worker/client envelopes, retain observations, terminate once and have no selectable or sendable text", async () => {
  for (const kind of ["blank", "all-failed", "failed-and-blank"]) {
    const bytes = await syntheticPdfPageReviewSample(kind);
    const envelope = await workerEnvelope(bytes);
    assert.equal(envelope.kind, "document-extraction-result");
    assert.equal(envelope.ok, false);
    assert.equal(envelope.text, undefined);
    assert.equal(envelope.note, undefined);
    assert.deepEqual(statuses(envelope.pdf), PDF_PAGE_REVIEW_SAMPLES[kind].statuses);
    assert.doesNotMatch(JSON.stringify(envelope), /XObject|SyntheticBrokenForm|FormatError/);
    const f = clientFixture(),
      abort = new AbortController();
    const pending = f.extract(
      {
        name: PDF_PAGE_REVIEW_SAMPLES[kind].name,
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      },
      abort.signal,
    );
    const rejection = assert.rejects(pending, (error) => {
      assert.ok(error instanceof metadata.PdfTextUnavailableError);
      assert.deepEqual(error.pdf, envelope.pdf);
      return true;
    });
    await tick();
    f.workers[0].onmessage({ data: envelope });
    await rejection;
    assert.equal(f.workers[0].terminated, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
    abort.abort();
    assert.equal(f.workers[0].terminated, 1);
    const tree = renderPages(envelope.pdf),
      output = text(tree).replace(/\s+/g, " ");
    assert.match(output, /0 with extracted text/);
    assert.match(output, /No extracted text can be sent/);
    assert.equal(elements(tree, (node) => ["input", "button"].includes(node.type)).length, 0);
    assert.doesNotMatch(output, /Text pages to send|Available text pages:/);
    if (kind === "all-failed") {
      assert.match(output, /Text extraction failed on pages 1-2/);
      assert.doesNotMatch(output, /No extractable text on pages/);
    }
    if (kind === "failed-and-blank") {
      assert.match(output, /Text extraction failed on pages 1/);
      assert.match(output, /No extractable text on pages 2/);
    }
  }
});

test("real mixed result crosses success envelopes while selecting failed or blank pages remains invalid", async () => {
  const bytes = await syntheticPdfPageReviewSample("mixed"),
    envelope = await workerEnvelope(bytes);
  assert.equal(envelope.ok, true);
  assert.deepEqual(statuses(envelope.pdf), ["extracted", "no_text", "failed"]);
  const f = clientFixture();
  const pending = f.extract({
    name: "synthetic-mixed.pdf",
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  });
  await tick();
  f.workers[0].onmessage({ data: envelope });
  const result = await pending;
  assert.deepEqual(result, metadata.validateDocumentExtractionResult(envelope, true));
  assert.match(
    metadata.selectPdfPages(result.pdf, "1").text,
    /^Selected PDF extracted text: pages 1 of 3/,
  );
  for (const input of ["2", "3", "1-3"])
    assert.throws(() => metadata.selectPdfPages(result.pdf, input), /No available extracted text/);
  assert.match(text(renderPages(result.pdf)), /Successful pages remain available/);
  assert.equal(f.workers[0].terminated, 1);
});

const bundledFonts = Object.fromEntries(
  [
    ...readFileSync("src/lib/library-pdf-fonts.ts", "utf8").matchAll(
      /pdfjs-dist\/standard_fonts\/([^?]+)\?inline&url/gu,
    ),
  ].map((match) => [
    match[1],
    `data:application/octet-stream;base64,${readFileSync(`node_modules/pdfjs-dist/standard_fonts/${match[1]}`).toString("base64")}`,
  ]),
);
async function realPreview(bytes, { requests = [], reads = [], closed = [] } = {}) {
  const root = new AbortController();
  const session = await previewHelper.loadLibraryPdfPreview(
    {
      ownerId: "synthetic-owner",
      id: "synthetic-pdf",
      generation: "synthetic-generation",
      signal: root.signal,
    },
    {
      readOriginal: async (...args) => {
        reads.push(args);
        return new Blob([bytes], { type: "application/pdf" });
      },
      loadRenderer: async () => ({
        getDocument: (options, onUnavailableResource) => {
          const Fonts = previewHelper.bundledPreviewFontFactory(
            bundledFonts,
            onUnavailableResource,
          );
          class Resources extends Fonts {
            async fetch(request) {
              requests.push(request);
              return super.fetch(request);
            }
          }
          return getDocument({
            ...options,
            ownerDocument: { createElement: () => createCanvas(1, 1) },
            BinaryDataFactory: Resources,
          });
        },
        destroy: () => closed.push(true),
      }),
    },
  );
  return { session, root, requests, reads, closed };
}
function countDark(canvas) {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 200 && pixels[i + 3] > 200) dark++;
  return dark;
}

test("actual text/blank/Form-error pages render text/white/zero-glyph fallback without claiming a UI error", async () => {
  const f = await realPreview(await syntheticPdfPageReviewSample("mixed"));
  const canvas = createCanvas(1, 1);
  await f.session.renderPage(1, canvas, new AbortController().signal);
  assert.ok(countDark(canvas) > 100);
  if (process.env.KOVA_PDF_CAPTURE_DIR)
    writeFileSync(
      `${process.env.KOVA_PDF_CAPTURE_DIR}/mixed-real-render.png`,
      canvas.toBuffer("image/png"),
    );
  await f.session.renderPage(2, canvas, new AbortController().signal);
  assert.equal(countDark(canvas), 0);
  const abort = new AbortController();
  await f.session.renderPage(3, canvas, abort.signal);
  assert.equal(
    countDark(canvas),
    0,
    "PDF.js suppresses this operator-list error despite rejecting text extraction",
  );
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  assert.match(
    previewHelper.previewFailureMessage(new Error("XObject should be a stream")),
    /could not be previewed safely/,
  );
  await f.session.renderPage(1, canvas, new AbortController().signal);
  assert.ok(countDark(canvas) > 100);
  f.session.destroy();
  assert.equal(f.closed.length, 1);
  assert.equal(f.reads[0][3].aborted, true);
});

test("actual named-CMap resource denial is an explicit preview failure even when PDF.js resolves a blank fallback", async () => {
  const f = await realPreview(await syntheticCmapDependentPdf());
  const canvas = createCanvas(1, 1);
  await assert.rejects(
    f.session.renderPage(1, canvas, new AbortController().signal),
    /rendering resource that is unavailable/,
  );
  assert.deepEqual(f.requests, [{ kind: "cMapUrl", filename: "90ms-RKSJ-H.bcmap" }]);
  // The native test canvas resets zero dimensions to its defaults; browser clearing
  // is asserted separately through the actual component's DOM-shaped canvas.
  assert.equal(countDark(canvas), 0);
  f.session.destroy();
  assert.equal(f.closed.length, 1);
});

function padPdf(bytes, size) {
  const data = Buffer.from(bytes),
    at = data.lastIndexOf("startxref");
  assert.ok(at > 0 && size >= data.length);
  return new Uint8Array(
    Buffer.concat([data.subarray(0, at), Buffer.alloc(size - data.length, 32), data.subarray(at)]),
  );
}
test("real PDF at exactly 10 MB reaches both installed parsers; one byte over is refused before parsing", async () => {
  const bytes = padPdf(await syntheticPdfPageReviewSample("blank"), limits.bytes);
  assert.equal(bytes.length, 10 * 1024 * 1024);
  await assert.rejects(extractPdfDocument(bytes.slice(), getDocument), (error) => {
    assert.deepEqual(statuses(error.pdf), ["no_text", "no_text"]);
    return true;
  });
  const f = await realPreview(bytes);
  assert.equal(f.session.pageCount, 2);
  f.session.destroy();
  let parsed = false;
  await assert.rejects(
    extractPdfDocument(new Uint8Array(limits.bytes + 1), () => {
      parsed = true;
    }),
    /10 MB/,
  );
  assert.equal(parsed, false);
  await assert.rejects(
    previewHelper.loadLibraryPdfPreview(
      {
        ownerId: "synthetic",
        id: "sample",
        generation: "fixed",
        signal: new AbortController().signal,
      },
      {
        readOriginal: async () =>
          new Blob([new Uint8Array(limits.bytes + 1)], { type: "application/pdf" }),
        loadRenderer: async () => {
          parsed = true;
        },
      },
    ),
    /10 MB/,
  );
  assert.equal(parsed, false);
});

test("bundled resource reader rejects malformed and over-limit envelopes and permits only exact own allowlist entries", async () => {
  for (const data of [
    "",
    "https://example.invalid/font.ttf",
    "data:font/ttf;base64,@@",
    "data:font/ttf;base64," + "A".repeat(400004),
  ]) {
    const Fonts = previewHelper.bundledPreviewFontFactory({ "synthetic.ttf": data });
    await assert.rejects(
      new Fonts().fetch({ kind: "standardFontDataUrl", filename: "synthetic.ttf" }),
      /bundled preview font is unavailable/,
    );
  }
  const Fonts = previewHelper.bundledPreviewFontFactory({
    "synthetic.ttf": "data:font/ttf;base64," + "A".repeat(400000),
  });
  assert.equal(
    (await new Fonts().fetch({ kind: "standardFontDataUrl", filename: "synthetic.ttf" })).length,
    300000,
  );
  for (const request of [
    { kind: "cMapUrl", filename: "synthetic.ttf" },
    { kind: "wasmUrl", filename: "synthetic.ttf" },
    { kind: "standardFontDataUrl", filename: "__proto__" },
  ])
    await assert.rejects(new Fonts().fetch(request), /unsupported rendering resource/);
});

function componentPreviewFixture(failure) {
  const loads = [],
    sessions = [],
    rootScopes = [],
    canvas = { width: 50, height: 50, getContext: () => ({}) };
  const fixture = reactFixture(
    "src/components/LibraryDocumentPreview.tsx",
    (exports) => () => {
      const tree = exports.LibraryDocumentPreview({
        ownerId: "synthetic-owner",
        item: {
          id: "synthetic-pdf",
          file_name: "Synthetic.pdf",
          file_type: "application/pdf",
          original_generation: "fixed",
        },
      });
      for (const node of nodes(tree)) if (node.type === "canvas") node.props.ref.current = canvas;
      return tree;
    },
    {
      modules: {
        "lucide-react": { LoaderCircle: "spinner" },
        "@/lib/library-document-preview": {
          ...previewHelper,
          loadLibraryPdfPreview: async (scope) => {
            loads.push(true);
            rootScopes.push(scope);
            const first = loads.length === 1;
            const trace = {
              pageCount: 2,
              destroyed: 0,
              calls: [],
              pageCleanups: 0,
              parserDestroyed: 0,
            };
            const session = await previewHelper.loadLibraryPdfPreview(scope, {
              readOriginal: async () =>
                new Blob(["%PDF-1.7 synthetic injected parser envelope"], {
                  type: "application/pdf",
                }),
              loadRenderer: async () => ({
                getDocument: () => ({
                  promise: Promise.resolve({
                    numPages: 2,
                    getPage: async () => {
                      if (first && failure === "getPage")
                        throw new Error("Private getPage failure payload");
                      return {
                        getViewport: ({ scale }) => ({
                          width: 400 * scale,
                          height: 280 * scale,
                          scale,
                        }),
                        cleanup: () => {
                          trace.pageCleanups++;
                        },
                        render: () => ({
                          promise: first
                            ? Promise.reject(new Error("Private render failure payload"))
                            : Promise.resolve(),
                          cancel() {},
                        }),
                      };
                    },
                  }),
                  destroy: async () => {
                    trace.parserDestroyed++;
                  },
                }),
                destroy() {},
              }),
            });
            const render = session.renderPage,
              destroy = session.destroy;
            session.renderPage = async (number, surface, signal) => {
              trace.calls.push({ number, signal });
              return render(number, surface, signal);
            };
            session.destroy = () => {
              trace.destroyed++;
              destroy();
            };
            sessions.push(trace);
            return session;
          },
        },
      },
      globals: { AbortController },
    },
  );
  fixture.render();
  return { ...fixture, loads, sessions, rootScopes, canvas };
}
test("actual preview component clears canvas, hides private page failure, disposes and explicitly retries after render/getPage rejection", async () => {
  for (const failure of ["render", "getPage"]) {
    const f = componentPreviewFixture(failure);
    await f.flush();
    await f.click("Load PDF preview");
    await f.flush();
    assert.equal(f.loads.length, 1);
    assert.ok(f.sessions[0].destroyed > 0);
    assert.equal(f.canvas.width, 0);
    assert.equal(f.canvas.height, 0);
    assert.match(f.text(), /Preview unavailable.*could not be previewed safely.*Extracted text/);
    assert.doesNotMatch(f.text(), /Private render|Private getPage/);
    assert.equal(f.sessions[0].parserDestroyed, 1);
    assert.equal(f.sessions[0].pageCleanups, failure === "render" ? 1 : 0);
    assert.equal(
      f.nodes().some((node) => node.type === "canvas"),
      false,
    );
    assert.equal(f.find("p", (node) => node.props.role === "alert").props["aria-live"], "polite");
    await f.click("Retry PDF preview");
    await f.flush();
    assert.equal(f.loads.length, 2);
    assert.equal(f.rootScopes[0].signal.aborted, true);
    assert.equal(f.sessions[0].calls[0].signal.aborted, true);
    assert.match(f.text(), /Page 1 of 2 displayed/);
    assert.equal(f.sessions[1].calls.length, 1);
    f.unmount();
    assert.ok(f.sessions[1].destroyed > 0);
  }
});

test("real huge MediaBox is safely scaled; real 101-page PDF is rejected before rendering", async () => {
  for (const { name, create } of Object.values(PDF_RESOURCE_REVIEW_SAMPLES))
    assert.deepEqual(
      await create(),
      new Uint8Array(readFileSync(`review-kit/review-samples/pdf-pages/${name}`)),
    );
  const large = await realPreview(await syntheticLargeMediaBoxPdf());
  const canvas = createCanvas(1, 1);
  await large.session.renderPage(1, canvas, new AbortController().signal);
  assert.equal(canvas.width, 1224);
  assert.equal(canvas.height, 1224);
  assert.ok(canvas.width * canvas.height <= limits.pixels);
  assert.ok(countDark(canvas) > 100);
  large.session.destroy();
  const bytes = await syntheticPageLimitPdf();
  await assert.rejects(extractPdfDocument(bytes.slice(), getDocument), /100 pages/);
  const closed = [];
  await assert.rejects(realPreview(bytes, { closed }), /100 pages/);
  assert.equal(closed.length, 1);
});

test("actual 101-page preview rejection keeps the immutable item text and offers explicit Retry without a canvas", async () => {
  const bytes = await syntheticPageLimitPdf();
  const item = Object.freeze({
    id: "synthetic-limit",
    file_name: "synthetic-101-page-limit.pdf",
    file_type: "application/pdf",
    original_generation: "fixed",
    content_text:
      "Synthetic saved text is still available. This is an intentionally over-limit original PDF.",
  });
  const originalText = item.content_text;
  let reads = 0,
    closes = 0;
  const failures = [];
  const f = reactFixture(
    "src/components/LibraryDocumentPreview.tsx",
    (exports) => () => exports.LibraryDocumentPreview({ ownerId: "synthetic-owner", item }),
    {
      modules: {
        "lucide-react": { LoaderCircle: "spinner" },
        "@/lib/library-document-preview": {
          ...previewHelper,
          loadLibraryPdfPreview: (scope) =>
            previewHelper
              .loadLibraryPdfPreview(scope, {
                readOriginal: async () => {
                  reads++;
                  return new Blob([bytes], { type: "application/pdf" });
                },
                loadRenderer: async () => ({
                  getDocument: (options) =>
                    getDocument({
                      ...options,
                      ownerDocument: { createElement: () => createCanvas(1, 1) },
                    }),
                  destroy() {
                    closes++;
                  },
                }),
              })
              .catch((error) => {
                failures.push(error);
                throw error;
              }),
        },
      },
      globals: { AbortController },
    },
  );
  f.render();
  await f.flush();
  await f.click("Load PDF preview");
  for (let i = 0; i < 50 && !f.nodes().some((node) => node.props?.role === "alert"); i++) {
    await tick();
    await f.flush();
  }
  assert.match(f.text(), /PDF preview supports up to 100 pages/, String(failures[0]?.stack));
  assert.equal(reads, 1);
  assert.equal(closes, 1);
  assert.equal(item.content_text, originalText);
  assert.equal(
    f.nodes().some((node) => node.type === "canvas"),
    false,
  );
  assert.ok(f.find("button", (node) => /Retry PDF preview/.test(text(node))));
  f.unmount();
});
