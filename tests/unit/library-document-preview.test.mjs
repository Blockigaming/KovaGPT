import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { reactFixture, nodes } from "../helpers/kova-react-fixture.mjs";

function loadHelper(timer = setTimeout) {
  const exports = {};
  new Function(
    "exports",
    "require",
    "setTimeout",
    ts.transpileModule(readFileSync("src/lib/library-document-preview.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, (name) => assert.fail(`Unexpected module ${name}`), timer);
  return exports;
}
const helper = loadHelper();
const { loadLibraryPdfPreview, LIBRARY_PDF_PREVIEW_LIMITS: limits } = helper;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const original = new Blob(["%PDF-1.7 private fixture"], { type: "application/pdf" });
const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ({}) });

function fixture(options = {}) {
  const calls = {
    reads: [],
    options: [],
    pages: [],
    renders: [],
    pageCleanups: [],
    cancels: 0,
    destroys: 0,
    workersDestroyed: 0,
  };
  const root = new AbortController();
  const page = (number) => ({
    getViewport: ({ scale }) => ({
      width: (options.width ?? 612) * scale,
      height: (options.height ?? 792) * scale,
      scale,
    }),
    cleanup: () => {
      calls.pageCleanups.push(number);
    },
    render: (args) => {
      calls.renders.push(args);
      return {
        promise: options.render?.promise ?? Promise.resolve(),
        cancel: () => {
          calls.cancels++;
          options.render?.reject(new DOMException("Cancelled", "AbortError"));
        },
      };
    },
  });
  const document = {
    numPages: options.pageCount ?? 3,
    getPage: async (number) => {
      calls.pages.push(number);
      return options.page?.promise ?? page(number);
    },
  };
  const renderer = {
    getDocument: (args) => {
      calls.options.push(args);
      return {
        promise: options.document?.promise ?? Promise.resolve(document),
        destroy: async () => {
          calls.destroys++;
        },
      };
    },
    destroy: () => {
      calls.workersDestroyed++;
    },
  };
  const dependencies = {
    readOriginal: async (...args) => {
      calls.reads.push(args);
      return options.read?.promise ?? options.blob ?? original;
    },
    loadRenderer: async () => options.renderer?.promise ?? renderer,
  };
  return {
    calls,
    root,
    renderer,
    dependencies,
    page,
    scope: { ownerId: "owner-a", id: "item-a", generation: "generation-a", signal: root.signal },
  };
}

test("PDF preview reads only the requested owner and immutable generation; renders one real canvas page without annotation layers", async () => {
  const f = fixture();
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  assert.equal(preview.pageCount, 3);
  assert.deepEqual(f.calls.reads[0].slice(0, 3), ["owner-a", "item-a", "generation-a"]);
  assert.deepEqual(f.calls.pages, []);
  const canvas = makeCanvas();
  await preview.renderPage(2, canvas, new AbortController().signal);
  assert.deepEqual(f.calls.pages, [2]);
  assert.equal(f.calls.renders[0].canvas, canvas);
  assert.equal(f.calls.renders[0].annotationMode, 0);
  assert.equal(f.calls.renders[0].isEditing, false);
  assert.ok(canvas.width > 0 && canvas.height > 0);
  assert.ok(canvas.width * canvas.height <= limits.pixels);
  assert.deepEqual(f.calls.pageCleanups, [2]);
  const config = f.calls.options[0];
  assert.ok(config.data instanceof Uint8Array);
  for (const key of [
    "useSystemFonts",
    "useWorkerFetch",
    "useWasm",
    "enableXfa",
    "isOffscreenCanvasSupported",
    "isImageDecoderSupported",
    "enableHWA",
  ])
    assert.equal(config[key], false, key);
  for (const key of [
    "disableFontFace",
    "stopAtErrors",
    "disableRange",
    "disableStream",
    "disableAutoFetch",
  ])
    assert.equal(config[key], true, key);
  for (const key of ["url", "docBaseUrl", "cMapUrl", "standardFontDataUrl", "wasmUrl", "iccUrl"])
    assert.equal(config[key], undefined, key);
  await assert.rejects(
    new config.BinaryDataFactory().fetch({
      kind: "cMapUrl",
      filename: "https://untrusted.test/payload",
    }),
    /unsupported rendering resource/,
  );
  preview.destroy();
  preview.destroy();
  assert.equal(f.calls.destroys, 1);
  assert.equal(f.calls.workersDestroyed, 1);
  assert.equal(f.calls.reads[0][3].aborted, true);
});

test("bounded loader accepts actual local PDF bytes through the installed parser", async () => {
  const file = await PDFDocument.create();
  file.addPage([400, 500]);
  file.addPage([500, 400]);
  const data = await file.save();
  const f = fixture({ blob: new Blob([data], { type: "application/pdf" }) });
  f.dependencies.loadRenderer = async () => ({
    getDocument: (options) =>
      getDocument({ ...options, ownerDocument: { createElement: () => createCanvas(1, 1) } }),
    destroy() {},
  });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  assert.equal(preview.pageCount, 2);
  preview.destroy();
});

test("actual synthetic Helvetica PDF renders visible pixels using bundled font bytes, with no external resources", async () => {
  const file = await PDFDocument.create();
  file.addPage([400, 280]).drawText("Synthetic first page", { x: 40, y: 220, size: 18 });
  file.addPage([400, 280]).drawText("Synthetic second page", { x: 40, y: 220, size: 18 });
  const bytes = await file.save();
  const f = fixture({ blob: new Blob([bytes], { type: "application/pdf" }) });
  const bundled = {};
  const fontSource = readFileSync("src/lib/library-pdf-fonts.ts", "utf8");
  for (const match of fontSource.matchAll(/pdfjs-dist\/standard_fonts\/([^?]+)\?inline&url/gu))
    bundled[match[1]] =
      `data:application/octet-stream;base64,${readFileSync(`node_modules/pdfjs-dist/standard_fonts/${match[1]}`).toString("base64")}`;
  const Fonts = helper.bundledPreviewFontFactory(bundled);
  for (const request of [
    { kind: "standardFontDataUrl", filename: "https://untrusted.test/font.ttf" },
    { kind: "standardFontDataUrl", filename: "../../secret" },
    { kind: "cMapUrl", filename: "LiberationSans-Regular.ttf" },
    { kind: "wasmUrl", filename: "LiberationSans-Regular.ttf" },
    { kind: "standardFontDataUrl", filename: "__proto__" },
  ])
    await assert.rejects(new Fonts().fetch(request), /unsupported rendering resource/);
  f.dependencies.loadRenderer = async () => ({
    getDocument: (options) =>
      getDocument({
        ...options,
        ownerDocument: { createElement: () => createCanvas(1, 1) },
        BinaryDataFactory: Fonts,
      }),
    destroy() {},
  });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  assert.equal(preview.pageCount, 2);
  const canvas = createCanvas(1, 1);
  await preview.renderPage(1, canvas, new AbortController().signal);
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150 && pixels[i + 3] > 200)
      dark++;
  assert.ok(dark > 100, `Expected visible rendered text; found ${dark} dark pixels`);
  preview.destroy();
});

test("invalid MIME, signature, size and empty PDFs never reach the renderer", async () => {
  for (const blob of [
    new Blob(["<script>run()</script>"], { type: "text/html" }),
    new Blob(["<script>run()</script>"], { type: "application/pdf" }),
    new Blob([new Uint8Array(limits.bytes + 1)], { type: "application/pdf" }),
    new Blob(["%PDF"], { type: "application/pdf" }),
  ]) {
    const f = fixture({ blob });
    await assert.rejects(loadLibraryPdfPreview(f.scope, f.dependencies), /PDF/);
    assert.equal(f.calls.options.length, 0);
  }
});

test("page count and page selection limits fail closed", async () => {
  for (const pageCount of [0, -1, 101, 1.5, Infinity, NaN]) {
    const f = fixture({ pageCount });
    await assert.rejects(loadLibraryPdfPreview(f.scope, f.dependencies), /100 pages/);
    assert.equal(f.calls.workersDestroyed, 1);
  }
  const f = fixture({ pageCount: 100 });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  for (const page of [0, 101, 1.5, NaN])
    await assert.rejects(
      preview.renderPage(page, makeCanvas(), new AbortController().signal),
      /available PDF page/,
    );
  assert.equal(f.calls.pages.length, 0);
  preview.destroy();
});

test("extreme dimensions, pixels and scratch canvas allocations stay bounded", () => {
  for (const dimensions of [
    [612, 792],
    [1e8, 1e8],
    [1e8, 2],
    [2, 1e8],
    [1600, 1600],
  ]) {
    const value = helper.boundedPreviewSize(...dimensions);
    assert.ok(value.width <= limits.dimension && value.height <= limits.dimension);
    assert.ok(value.width * value.height <= limits.pixels);
  }
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => helper.boundedPreviewSize(value, 100), /dimensions/);
  const factory = new helper.BoundedPreviewCanvasFactory({
    ownerDocument: { createElement: makeCanvas },
  });
  assert.throws(() => factory.create(1e6, 1e6), /rendering limit/);
  const allocated = Array.from({ length: 4 }, () => factory.create(1000, 1500));
  assert.throws(() => factory.create(1, 1), /rendering limit/);
  factory.destroy(allocated[0]);
  assert.equal(allocated[0].canvas, null);
  const next = factory.create(1000, 1500);
  assert.throws(() => factory.reset(next, Infinity, 100), /rendering limit/);
  factory.reset(next, 100, 100);
  assert.equal(next.canvas.width, 100);
});

test("scope abort during the private read rejects immediately and ignores late bytes", async () => {
  const read = deferred(),
    f = fixture({ read });
  const result = loadLibraryPdfPreview(f.scope, f.dependencies);
  f.root.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(f.calls.reads[0][3].aborted, true);
  read.resolve(original);
  await tick();
  assert.equal(f.calls.options.length, 0);
});

test("scope abort during renderer loading destroys a late worker and never parses", async () => {
  const pending = deferred(),
    f = fixture({ renderer: pending });
  const result = loadLibraryPdfPreview(f.scope, f.dependencies);
  await tick();
  f.root.abort();
  await assert.rejects(result, { name: "AbortError" });
  pending.resolve(f.renderer);
  await tick();
  assert.equal(f.calls.workersDestroyed, 1);
  assert.equal(f.calls.options.length, 0);
});

test("scope abort destroys a parser in flight and prevents any page display", async () => {
  const document = deferred(),
    f = fixture({ document });
  const result = loadLibraryPdfPreview(f.scope, f.dependencies);
  await tick();
  f.root.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(f.calls.destroys, 1);
  assert.equal(f.calls.workersDestroyed, 1);
  document.resolve({ numPages: 1 });
  await tick();
  assert.equal(f.calls.pages.length, 0);
});

test("cancelling a page cancels its render, clears its canvas and releases page resources", async () => {
  const render = deferred(),
    f = fixture({ render });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  const controller = new AbortController(),
    canvas = makeCanvas();
  const result = preview.renderPage(1, canvas, controller.signal);
  await tick();
  await assert.rejects(
    preview.renderPage(2, makeCanvas(), new AbortController().signal),
    /current PDF page/,
  );
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.ok(f.calls.cancels > 0);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  assert.ok(f.calls.pageCleanups.includes(1));
  preview.destroy();
});

test("closing the owner scope cancels drawing and destroys the dedicated worker", async () => {
  const render = deferred(),
    f = fixture({ render });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  const result = preview.renderPage(1, makeCanvas(), new AbortController().signal);
  await tick();
  f.root.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(f.calls.workersDestroyed, 1);
  await assert.rejects(preview.renderPage(2, makeCanvas(), new AbortController().signal), {
    name: "AbortError",
  });
});

test("a late getPage after cancellation is cleaned without rendering", async () => {
  const pending = deferred(),
    f = fixture({ page: pending });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  const controller = new AbortController();
  const result = preview.renderPage(1, makeCanvas(), controller.signal);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  pending.resolve(f.page(1));
  await tick();
  assert.equal(f.calls.renders.length, 0);
  assert.ok(f.calls.pageCleanups.includes(1));
  preview.destroy();
});

test("loading and rendering deadlines terminate work rather than retaining a hung worker", async () => {
  const fast = loadHelper((callback, milliseconds) =>
    setTimeout(callback, milliseconds > 100 ? 5 : milliseconds),
  );
  const f = fixture({ document: deferred() });
  await assert.rejects(fast.loadLibraryPdfPreview(f.scope, f.dependencies), /took too long/);
  assert.equal(f.calls.workersDestroyed, 1);
  assert.equal(f.calls.reads[0][3].aborted, true);
  const p = fixture({ render: deferred() });
  const preview = await fast.loadLibraryPdfPreview(p.scope, p.dependencies);
  await assert.rejects(
    preview.renderPage(1, makeCanvas(), new AbortController().signal),
    /took too long/,
  );
  assert.equal(p.calls.workersDestroyed, 1);
  assert.ok(p.calls.cancels > 0);
});

test("unsupported office files are explicit; private parser diagnostics never become UI text", () => {
  for (const extension of ["docx", "xlsx", "pptx"]) {
    const result = helper.documentPreviewAvailability(
      { file_name: `Report.${extension}`, file_type: null, original_generation: "generation" },
      "owner",
    );
    assert.equal(result.available, false);
    assert.match(
      result.message,
      new RegExp(`${extension.toUpperCase()} original preview is unavailable`),
    );
  }
  assert.equal(
    helper.documentPreviewAvailability(
      { file_name: "report.pdf", file_type: "application/pdf" },
      "owner",
    ).available,
    false,
  );
  assert.doesNotMatch(
    helper.previewFailureMessage(new Error("secret document content")),
    /secret document content/,
  );
  const password = new Error("secret details");
  password.name = "PasswordException";
  assert.match(helper.previewFailureMessage(password), /password protected/);
});

function componentFixture(overrides = {}) {
  const requests = [],
    sessions = [];
  const focuses = [];
  const props = {
    ownerId: "owner-a",
    item: {
      id: "item-a",
      file_name: "Saved.pdf",
      file_type: "application/pdf",
      original_generation: "generation-a",
    },
  };
  Object.assign(props, overrides);
  const canvas = makeCanvas();
  const f = reactFixture(
    "src/components/LibraryDocumentPreview.tsx",
    (exports) => () => {
      const result = exports.LibraryDocumentPreview(props);
      for (const node of nodes(result)) {
        if (node.type === "canvas") node.props.ref.current = canvas;
        if (node.type === "p" && node.props.ref)
          node.props.ref.current = { focus: (options) => focuses.push(options) };
      }
      return result;
    },
    {
      modules: {
        "lucide-react": { LoaderCircle: "loading-spinner" },
        "@/lib/library-document-preview": {
          ...helper,
          loadLibraryPdfPreview: (scope) => {
            const pending = deferred();
            requests.push({ scope, pending });
            return pending.promise;
          },
        },
      },
      globals: { AbortController },
    },
  );
  const resolve = (index = requests.length - 1, options = {}) => {
    const session = {
      pageCount: options.pageCount ?? 2,
      pages: [],
      views: [],
      failRender: false,
      destroyed: 0,
      renderPage: async (number, surface, signal, zoom) => {
        session.pages.push(number);
        session.views.push({ number, zoom, signal });
        if (session.failRender) throw new Error("private render internals");
      },
      destroy: () => {
        session.destroyed++;
      },
    };
    sessions.push(session);
    requests[index].pending.resolve(session);
    return session;
  };
  f.render();
  return { ...f, props, requests, sessions, resolve, canvas, focuses };
}

test("component is explicit-load, keyboard-button operable, paginated and has readable statuses", async () => {
  const f = componentFixture();
  await f.flush();
  assert.equal(f.requests.length, 0);
  assert.match(f.text(), /has not been loaded/);
  await f.click("Load PDF preview");
  assert.equal(f.requests.length, 1);
  assert.match(f.text(), /Loading original PDF/);
  assert.equal(f.find("loading-spinner").props.size, 16);
  const session = f.resolve();
  await f.flush();
  assert.deepEqual(session.pages, [1]);
  const navigation = f.find("div", (node) => node.props["aria-label"] === "PDF page navigation");
  assert.equal(navigation.props.role, "group");
  assert.match(navigation.props.className, /w-full.*sm:w-auto/);
  assert.equal(f.focuses.length, 0, "Completion must not steal focus");
  assert.equal(
    f.find("button", (n) => n.props["aria-label"] === "Previous PDF page").props.disabled,
    true,
  );
  await f.click("Next PDF page");
  assert.equal(f.focuses.length, 1);
  assert.equal(f.focuses[0].preventScroll, true);
  assert.equal(f.find("p", (node) => node.props.role === "status").props.tabIndex, -1);
  assert.deepEqual(session.pages, [1, 2]);
  assert.match(f.text(), /Page 2 of 2 displayed/);
  assert.equal(
    f.find("button", (n) => n.props["aria-label"] === "Next PDF page").props.disabled,
    true,
  );
  assert.equal(f.find("canvas").props.role, "img");
  assert.match(f.find("canvas").props["aria-label"], /Use Extracted text/);
  for (const button of f.nodes().filter((n) => n.type === "button"))
    assert.match(button.props.className, /min-h-11/);
  await f.click("Close PDF preview");
  assert.equal(f.focuses.length, 1, "Closing and completion must not steal focus");
  assert.equal(f.requests[0].scope.signal.aborted, true);
  assert.ok(session.destroyed > 0);
  assert.equal(
    f.nodes().some((node) => node.type === "canvas"),
    false,
  );
  f.unmount();
});

test("owner, item and generation changes hide old results immediately and require another explicit load", async () => {
  for (const change of [
    () => ({ ownerId: "owner-b" }),
    (f) => ({ item: { ...f.props.item, id: "item-b" } }),
    (f) => ({ item: { ...f.props.item, original_generation: "generation-b" } }),
  ]) {
    const f = componentFixture();
    await f.flush();
    await f.click("Load PDF preview");
    Object.assign(f.props, change(f));
    f.render();
    assert.equal(
      f.nodes().some((node) => node.type === "canvas"),
      false,
    );
    await f.flush();
    assert.equal(f.requests[0].scope.signal.aborted, true);
    const late = f.resolve(0);
    await f.flush();
    assert.ok(late.destroyed > 0);
    assert.equal(f.requests.length, 1);
    assert.match(f.text(), /has not been loaded/);
    f.unmount();
  }
});

test("unmount cancels loading and disposes a late completion without showing a preview", async () => {
  const f = componentFixture();
  await f.flush();
  await f.click("Load PDF preview");
  f.unmount();
  assert.equal(f.requests[0].scope.signal.aborted, true);
  const late = f.resolve();
  await tick();
  assert.equal(late.destroyed, 1);
});

test("changing owner after a displayed page hides and clears the old canvas and destroys its session", async () => {
  const f = componentFixture();
  await f.flush();
  await f.click("Load PDF preview");
  const session = f.resolve();
  await f.flush();
  assert.equal(f.nodes().filter((node) => node.type === "canvas").length, 1);
  f.props.ownerId = "owner-b";
  f.render();
  assert.equal(
    f.nodes().some((node) => node.type === "canvas"),
    false,
  );
  await f.flush();
  assert.ok(session.destroyed > 0);
  assert.equal(f.canvas.width, 0);
  assert.equal(f.canvas.height, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.focuses.length, 0);
  f.unmount();
});

test("office and missing-original states offer no ineffective load control", async () => {
  for (const change of [
    {
      file_name: "notes.docx",
      file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    { original_generation: undefined },
  ]) {
    const f = componentFixture();
    Object.assign(f.props.item, change);
    await f.flush();
    assert.equal(f.requests.length, 0);
    assert.equal(
      f.nodes().some((node) => node.type === "button"),
      false,
    );
    assert.match(f.text(), /unavailable/);
    f.unmount();
  }
});

test("loading failure has a bounded error message and a working retry", async () => {
  const f = componentFixture();
  await f.flush();
  await f.click("Load PDF preview");
  f.requests[0].pending.reject(new Error("private parser detail"));
  await f.flush();
  assert.equal(f.find("p", (n) => n.props.role === "alert").props["aria-live"], "polite");
  assert.doesNotMatch(f.text(), /private parser detail/);
  await f.click("Retry PDF preview");
  assert.equal(f.requests.length, 2);
  f.resolve();
  await f.flush();
  assert.match(f.text(), /Page 1 of 2 displayed/);
  f.unmount();
});

test("inspector separates original preview from extracted text and never embeds a document URL", () => {
  const route = readFileSync("src/routes/library.tsx", "utf8");
  assert.match(route, /previewView === "preview" \? \(\s*<LibraryDocumentPreview/u);
  assert.match(route, /ownerId=\{isSignedIn \? userKey : null\}/u);
  assert.match(route, /<LibraryImageMedia\s+item=\{visiblePreviewItem\}/u);
  const source = readFileSync("src/components/LibraryDocumentPreview.tsx", "utf8");
  assert.doesNotMatch(
    source,
    /<iframe|<object|<embed|dangerouslySetInnerHTML|file_url|content_text/u,
  );
  const adapter = readFileSync("src/lib/library-pdf-renderer.ts", "utf8");
  assert.match(adapter, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs\?url/u);
  assert.match(adapter, /new Worker\(workerUrl, \{ type: "module" \}\)/u);
  assert.match(adapter, /PDFWorker\.create\(\{ port, verbosity: 0 \}\)/u);
  assert.match(adapter, /port\.terminate\(\)/u);
  assert.doesNotMatch(adapter, /https?:|GlobalWorkerOptions/u);
});

test("PDF pagination uses scoped opaque neutral disabled colors", () => {
  const css = readFileSync("src/styles/spec400-management.css", "utf8");
  assert.match(
    css,
    /\.spec400-pdf-pagination button:disabled\s*\{[^}]*opacity: 1;[^}]*background-color: var\(--muted\);[^}]*color: var\(--muted-foreground\);/,
  );
});

test("installed PDF renderer has no dynamic eval constructor and preview uses supported options", () => {
  for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
    const source = readFileSync(`node_modules/pdfjs-dist/legacy/build/${file}`, "utf8");
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/);
  }
  assert.doesNotMatch(
    readFileSync("src/lib/library-document-preview.ts", "utf8"),
    /isEvalSupported/,
  );
});

test("view memory is bounded, account-isolated, generation-scoped and stores only safe view numbers", () => {
  const memory = helper.createLibraryDocumentViewMemory("owner-a");
  const identity = { ownerId: "owner-a", id: "item-a", generation: "generation-a" };
  assert.deepEqual(memory.read(identity), { page: 1, zoom: 1 });
  memory.remember(identity, { page: 3, zoom: 1.25, content: "private bytes must never survive" });
  const first = memory.read(identity);
  assert.deepEqual(first, { page: 3, zoom: 1.25 });
  first.page = 42;
  assert.equal(memory.read(identity).page, 3, "Reading cannot mutate retained preferences");
  assert.deepEqual(memory.read({ ...identity, ownerId: "owner-b" }), { page: 1, zoom: 1 });
  memory.remember({ ...identity, ownerId: "owner-b" }, { page: 9, zoom: 2 });
  assert.deepEqual(memory.read(identity), { page: 3, zoom: 1.25 });
  const replacement = { ...identity, generation: "replacement" };
  assert.deepEqual(memory.read(replacement), { page: 1, zoom: 1 });
  memory.remember(identity, { page: 8, zoom: 2 });
  assert.deepEqual(
    memory.read(replacement),
    { page: 1, zoom: 1 },
    "Late old-generation writes are ignored",
  );
  for (const invalid of [
    { ...identity, generation: undefined },
    { ...identity, ownerId: null },
    { ...identity, id: "x".repeat(257) },
  ])
    assert.deepEqual(memory.read(invalid), { page: 1, zoom: 1 });
  memory.remember(replacement, { page: Infinity, zoom: NaN });
  assert.deepEqual(memory.read(replacement), { page: 1, zoom: 1 });
  memory.remember(replacement, { page: 1000, zoom: 2 });
  assert.deepEqual(memory.read(replacement), { page: 100, zoom: 2 });
  for (let index = 0; index < helper.LIBRARY_PDF_VIEW_MEMORY_LIMIT; index++)
    memory.read({ ...identity, id: `bounded-${index}` });
  assert.deepEqual(
    memory.read(replacement),
    { page: 1, zoom: 1 },
    "Least recently used preferences are evicted",
  );
  assert.deepEqual(helper.createLibraryDocumentViewMemory("owner-a").read(identity), {
    page: 1,
    zoom: 1,
  });
});

test("closing and reopening document details restores the same original page and zoom, without retaining a session", async () => {
  const viewMemory = helper.createLibraryDocumentViewMemory("owner-a");
  const first = componentFixture({ viewMemory });
  await first.flush();
  await first.click("Load PDF preview");
  const firstSession = first.resolve();
  await first.flush();
  await first.click("Next PDF page");
  await first.click("Zoom in PDF");
  assert.equal(first.find("canvas").props.style.width, "125%");
  assert.deepEqual(
    firstSession.views.map(({ number, zoom }) => [number, zoom]),
    [
      [1, 1],
      [2, 1],
      [2, 1.25],
    ],
  );
  first.unmount();
  assert.ok(firstSession.destroyed > 0);
  assert.ok(firstSession.views.at(-1).signal.aborted);
  const reopened = componentFixture({ viewMemory });
  await reopened.flush();
  assert.equal(
    reopened.requests.length,
    0,
    "Reopening must still require an explicit original read",
  );
  await reopened.click("Load PDF preview");
  const fresh = reopened.resolve();
  await reopened.flush();
  assert.deepEqual(
    fresh.views.map(({ number, zoom }) => [number, zoom]),
    [[2, 1.25]],
  );
  assert.match(reopened.text(), /Page 2 of 2 displayed\. Zoom 125%/);
  assert.equal(reopened.focuses.length, 0);
  await reopened.click("Close PDF preview");
  await reopened.click("Load PDF preview");
  const loadedAgain = reopened.resolve();
  await reopened.flush();
  assert.deepEqual(
    loadedAgain.views.map(({ number, zoom }) => [number, zoom]),
    [[2, 1.25]],
  );
  reopened.unmount();
});

test("different identity or original generation resets page and zoom; account reset does not revive prior preferences", async () => {
  const identity = { ownerId: "owner-a", id: "item-a", generation: "generation-a" };
  for (const change of [
    { ownerId: "owner-b" },
    { id: "item-b" },
    { generation: "generation-b" },
    { reset: true },
  ]) {
    const memory = helper.createLibraryDocumentViewMemory("owner-a");
    memory.read(identity);
    memory.remember(identity, { page: 2, zoom: 1.5 });
    const f = componentFixture({
      ownerId: change.ownerId ?? identity.ownerId,
      item: {
        id: change.id ?? identity.id,
        original_generation: change.generation ?? identity.generation,
        file_name: "Renamed source.pdf",
        file_type: "application/pdf",
      },
      viewMemory: change.reset ? helper.createLibraryDocumentViewMemory("owner-a") : memory,
    });
    await f.flush();
    await f.click("Load PDF preview");
    const session = f.resolve();
    await f.flush();
    assert.deepEqual(
      session.views.map(({ number, zoom }) => [number, zoom]),
      [[1, 1]],
    );
    f.unmount();
  }
  const route = readFileSync("src/routes/library.tsx", "utf8");
  assert.match(
    route,
    /createLibraryDocumentViewMemory\(isLoaded && isSignedIn && !libraryCleared \? userKey : null\),\s*\[isLoaded, isSignedIn, userKey, libraryCleared\]/,
  );
  assert.match(route, /viewMemory=\{documentViewMemory\}/);
  const source = readFileSync("src/lib/library-document-preview.ts", "utf8");
  const memorySource = source.slice(
    source.indexOf("export function createLibraryDocumentViewMemory"),
    source.indexOf("export type LibraryDocumentViewMemory"),
  );
  assert.doesNotMatch(
    memorySource,
    /localStorage|sessionStorage|indexedDB|content_text|file_url|Blob|canvas|renderer|session/,
  );
});

test("restored page is clamped to the confirmed count, and failed zoom retains preferences for explicit retry", async () => {
  const memory = helper.createLibraryDocumentViewMemory("owner-a");
  const identity = { ownerId: "owner-a", id: "item-a", generation: "generation-a" };
  memory.read(identity);
  memory.remember(identity, { page: 99, zoom: 1.25 });
  const f = componentFixture({ viewMemory: memory });
  await f.flush();
  await f.click("Load PDF preview");
  const session = f.resolve();
  await f.flush();
  assert.deepEqual(
    session.views.map(({ number, zoom }) => [number, zoom]),
    [[2, 1.25]],
  );
  session.failRender = true;
  await f.click("Zoom in PDF");
  assert.match(f.text(), /Preview unavailable/);
  assert.doesNotMatch(f.text(), /private render internals/);
  assert.equal(
    f.nodes().some((node) => node.type === "canvas"),
    false,
  );
  assert.equal(f.canvas.width, 0);
  assert.ok(session.destroyed > 0);
  await f.click("Retry PDF preview");
  const retried = f.resolve();
  await f.flush();
  assert.deepEqual(
    retried.views.map(({ number, zoom }) => [number, zoom]),
    [[2, 1.5]],
  );
  f.unmount();
});

test("zoom rerenders actual page viewports within unchanged dimension, pixel and scratch bounds", async () => {
  const f = fixture();
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  const canvas = makeCanvas();
  for (const zoom of helper.LIBRARY_PDF_ZOOM_LEVELS) {
    await preview.renderPage(1, canvas, new AbortController().signal, zoom);
    assert.ok(canvas.width <= limits.dimension && canvas.height <= limits.dimension);
    assert.ok(canvas.width * canvas.height <= limits.pixels);
    assert.equal(
      f.calls.renders.at(-1).viewport.scale,
      helper.boundedPreviewSize(612, 792, zoom).scale,
    );
  }
  assert.ok(f.calls.renders[0].viewport.scale < f.calls.renders[2].viewport.scale);
  for (const zoom of [0, -1, Infinity, NaN, 100, 1.1])
    await assert.rejects(
      preview.renderPage(1, canvas, new AbortController().signal, zoom),
      /zoom level/,
    );
  preview.destroy();
});

test("zoom controls stop at supported limits and scrolling belongs to the document area", async () => {
  const f = componentFixture();
  await f.flush();
  await f.click("Load PDF preview");
  f.resolve();
  await f.flush();
  for (let index = 0; index < 3; index++) await f.click("Zoom in PDF");
  assert.equal(
    f.find("button", (node) => node.props["aria-label"] === "Zoom in PDF").props.disabled,
    true,
  );
  assert.equal(f.find("canvas").props.style.width, "200%");
  for (let index = 0; index < 5; index++) await f.click("Zoom out PDF");
  assert.equal(
    f.find("button", (node) => node.props["aria-label"] === "Zoom out PDF").props.disabled,
    true,
  );
  assert.equal(f.find("canvas").props.style.width, "50%");
  const region = f.find("div", (node) => node.props.role === "region");
  assert.match(region.props.className, /max-h-\[65dvh\].*overflow-auto.*overscroll-contain/);
  assert.equal(region.props.tabIndex, 0);
  f.unmount();
});

test("valid blank and image-only PDFs render successfully without requiring extracted text or dark pixels", async () => {
  const file = await PDFDocument.create();
  file.addPage([400, 280]);
  const scan = createCanvas(20, 20);
  const context = scan.getContext("2d");
  context.fillStyle = "black";
  context.fillRect(3, 3, 14, 14);
  const image = await file.embedPng(scan.toBuffer("image/png"));
  file.addPage([400, 280]).drawImage(image, { x: 40, y: 40, width: 160, height: 160 });
  const f = fixture({ blob: new Blob([await file.save()], { type: "application/pdf" }) });
  f.dependencies.loadRenderer = async () => ({
    getDocument: (options) =>
      getDocument({ ...options, ownerDocument: { createElement: () => createCanvas(1, 1) } }),
    destroy() {},
  });
  const preview = await loadLibraryPdfPreview(f.scope, f.dependencies);
  for (const page of [1, 2])
    await assert.doesNotReject(
      preview.renderPage(page, createCanvas(1, 1), new AbortController().signal),
    );
  preview.destroy();
});

test("Library wording distinguishes original, saved title, extraction and generated export", () => {
  const route = readFileSync("src/routes/library.tsx", "utf8");
  assert.match(
    route,
    /<dt>Original filename<\/dt>\s*<dd>\{visiblePreviewItem.file_name\?\.trim\(\) \|\| "Not recorded"\}<\/dd>/,
  );
  assert.match(route, /<dt>Saved title<\/dt>/);
  assert.match(route, /<dt>Stored size<\/dt>/);
  assert.match(route, /Original\s*<\/button>/);
  assert.match(route, /No extracted text available/);
  assert.match(route, /a generated export is a separate file/);
  assert.match(
    readFileSync("src/components/LibraryRenameDialog.tsx", "utf8"),
    /<DialogTitle>Rename saved title<\/DialogTitle>/,
  );
});
