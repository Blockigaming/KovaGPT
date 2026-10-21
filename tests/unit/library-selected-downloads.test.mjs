import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
const original = "44444444-4444-4444-8444-444444444444";
const second = "55555555-5555-4555-8555-555555555555";
const makeItem = (extra = {}) => ({
  id,
  title: "Research",
  file_name: "research.pdf",
  file_url: null,
  file_type: "application/pdf",
  item_type: "document",
  file_size: 100,
  content_generation: generation,
  original_generation: original,
  content_text: "Private extracted text",
  ...extra,
});
const safe = loadUiModule("src/lib/safe-url.ts", {}, { URL });
const imageSafe = loadUiModule("src/lib/safe-image-url.ts", { "./safe-url.ts": safe });
const imageUrls = loadUiModule("src/lib/library-image-url.ts", {
  "./safe-image-url.ts": imageSafe,
});

function fixture(source = makeItem()) {
  const calls = [],
    urls = [],
    revoked = [],
    downloads = [],
    timers = new Map();
  const state = {
    current: true,
    fresh: source,
    fetch: async () => new Response("image bytes", { headers: { "Content-Type": "image/png" } }),
    original: async () => new Blob(["original file"], { type: "application/pdf" }),
    workUrl: "/api/private-files?id=verified",
    imageUrl: "/api/library/files?kind=image&id=verified",
    clickError: false,
  };
  class FakeURL extends URL {
    static createObjectURL(blob) {
      urls.push(blob);
      return `blob:fixture-${urls.length}`;
    }
    static revokeObjectURL(url) {
      revoked.push(url);
    }
  }
  const globals = {
    URL: FakeURL,
    Blob,
    AbortSignal,
    DOMException,
    Error,
    window: { location: { origin: "https://kova.test" } },
    fetch: async (...args) => {
      calls.push(["fetch", ...args]);
      return state.fetch(...args);
    },
    setTimeout: (fn) => {
      const key = timers.size + 1;
      timers.set(key, fn);
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
    document: {
      body: { appendChild: () => calls.push(["append"]) },
      createElement: () => ({
        click() {
          if (state.clickError) throw new Error("browser refused");
          downloads.push({ href: this.href, name: this.download });
        },
        remove() {
          calls.push(["remove"]);
        },
      }),
    },
  };
  const helper = loadUiModule(
    "src/lib/library-selected-downloads.ts",
    {
      "@/lib/library-image-url": imageUrls,
      "@/lib/safe-image-url": imageSafe,
      "@/lib/safe-url": safe,
      "@/lib/endpoint-reliability.mjs": reliability,
      "@/lib/library-items-client": {
        readLibraryItemAtGeneration: async (...args) => {
          calls.push(["read", ...args]);
          return state.fresh;
        },
      },
      "@/lib/library-original-client": {
        readOriginalLibraryFile: async (...args) => {
          calls.push(["original", ...args]);
          return state.original(...args);
        },
      },
      "@/lib/work-sync-client": {
        requestWorkSync: async (...args) => {
          calls.push(["work", ...args]);
          return { url: state.workUrl };
        },
      },
      "@/lib/library-images.functions": {
        getLibraryImageUrl: async (...args) => {
          calls.push(["image", ...args]);
          return { url: state.imageUrl };
        },
      },
    },
    globals,
  );
  const entry = helper.selectedLibraryDownloadSnapshot([source.id], [source], owner).entries[0];
  const controller = new AbortController();
  return {
    helper,
    entry,
    state,
    calls,
    urls,
    revoked,
    downloads,
    timers,
    controller,
    read: () =>
      helper.readSelectedLibraryDownload(owner, entry, controller.signal, () => state.current),
    start: () =>
      helper.startSelectedLibraryDownload(owner, entry, controller.signal, () => state.current),
  };
}

test("bounded metadata snapshot counts every selected row without retaining text or truncating over-limit selections", () => {
  const { helper } = fixture();
  const items = [
    makeItem(),
    makeItem({ id: second, original_generation: undefined, file_name: null, content_text: "note" }),
    makeItem({ id: "chat:local", original_generation: undefined, content_generation: undefined }),
  ];
  const selected = [id, second, "chat:local", "missing"];
  const snapshot = helper.selectedLibraryDownloadSnapshot(selected, items, owner);
  assert.equal(snapshot.count, 4);
  assert.equal(snapshot.eligibleCount, 1);
  assert.equal(snapshot.unsupportedCount, 3);
  assert.match(snapshot.entries[1].reason, /Preview or Reuse in chat/);
  assert.match(snapshot.entries[3].reason, /no longer loaded/);
  assert.equal("content_text" in snapshot.entries[0].item, false);
  items[0].title = "New title";
  selected.pop();
  assert.equal(snapshot.entries[0].item.title, "Research");
  assert.equal(snapshot.count, 4);
  const over = helper.selectedLibraryDownloadSnapshot(
    Array.from({ length: 21 }, (_, i) => `item-${i}`),
    [],
    owner,
  );
  assert.equal(over.count, 21);
  assert.equal(over.overLimit, true);
  assert.equal(over.entries.length, 0);
  assert.equal(
    helper.selectedLibraryDownloadSnapshot(
      Array.from({ length: 20 }, (_, i) => `item-${i}`),
      [],
      owner,
    ).entries.length,
    20,
  );
});

test("unsupported linked files direct people to the individual menu and large files fail eligibility", () => {
  const { helper } = fixture();
  const items = [
    makeItem({ original_generation: undefined, file_url: "https://example.test/file" }),
    makeItem({ id: second, file_size: 11 * 1024 * 1024 }),
  ];
  const snapshot = helper.selectedLibraryDownloadSnapshot([id, second], items, owner);
  assert.equal(snapshot.eligibleCount, 0);
  assert.match(snapshot.entries[0].reason, /Actions → Open or download/);
  assert.match(snapshot.entries[1].reason, /size limit/);
  assert.equal(helper.selectedLibraryDownloadSnapshot([id], [makeItem()], null).eligibleCount, 0);
});

test("original file read pins owner, identity and original generation, then revokes its sole object URL", async () => {
  const f = fixture();
  const pending = f.start();
  await settle();
  assert.equal(f.calls[0][0], "read");
  assert.equal(f.calls[0][1], owner);
  assert.equal(f.calls[0][2].content_generation, generation);
  assert.deepEqual(f.calls.find((call) => call[0] === "original").slice(1, 4), [
    owner,
    id,
    original,
  ]);
  assert.deepEqual(f.downloads, [{ href: "blob:fixture-1", name: "research.pdf" }]);
  assert.equal(f.urls.length, 1);
  assert.equal(f.revoked.length, 0);
  for (const fn of f.timers.values()) fn();
  await pending;
  assert.deepEqual(f.revoked, ["blob:fixture-1"]);
  assert.equal(f.timers.size, 0);
});

for (const change of ["owner-or-route", "abort", "replacement"])
  test(`pending original file never reaches browser after ${change}`, async () => {
    const f = fixture();
    const blocked = deferred();
    if (change === "replacement") f.state.fresh = { ...f.state.fresh, original_generation: second };
    else f.state.original = () => blocked.promise;
    const pending = assert.rejects(f.start());
    await settle();
    if (change === "owner-or-route") f.state.current = false;
    if (change === "abort") f.controller.abort();
    blocked.resolve(new Blob(["late"]));
    await pending;
    assert.equal(f.downloads.length, 0);
    assert.equal(f.urls.length, 0);
  });

test("closing during browser consumption and browser handoff failure both revoke object URLs", async () => {
  const f = fixture();
  const pending = f.start();
  await settle();
  f.controller.abort();
  await pending;
  assert.deepEqual(f.revoked, ["blob:fixture-1"]);
  const failure = fixture();
  failure.state.clickError = true;
  await assert.rejects(failure.start(), /browser refused/);
  assert.deepEqual(failure.revoked, ["blob:fixture-1"]);
});

test("Work download uses the guarded output resolver and same-origin credentials only", async () => {
  const f = fixture(makeItem({ original_generation: undefined, work_output: true }));
  await f.read();
  const work = f.calls.find((call) => call[0] === "work");
  assert.equal(work[1], owner);
  assert.equal(work[2], `/api/work/output?id=${id}`);
  const fetched = f.calls.find((call) => call[0] === "fetch");
  assert.equal(fetched[2].credentials, "same-origin");
  assert.equal(fetched[2].redirect, "error");
  const external = fixture(makeItem({ original_generation: undefined, work_output: true }));
  external.state.workUrl = "https://storage.test/signed-file?token=opaque";
  await external.read();
  assert.equal(external.calls.find((call) => call[0] === "fetch")[2].credentials, "omit");
});

test("unsafe or wrong private destinations never trigger download fetches", async () => {
  for (const url of [
    "javascript:alert(1)",
    "not-a-download-url",
    "//evil.test/file",
    "/api/admin",
    "/\\evil.test/file",
    "https://u:p@storage.test/file",
    "https://storage.test/file#frag",
    "http://storage.test/file",
  ]) {
    const f = fixture(makeItem({ original_generation: undefined, work_output: true }));
    f.state.workUrl = url;
    await assert.rejects(f.read());
    assert.equal(f.calls.filter((call) => call[0] === "fetch").length, 0, url);
  }
});

test("private images reuse the signer only after generation validation, then require raster MIME and bounded bytes", async () => {
  const source = makeItem({
    original_generation: undefined,
    item_type: "image",
    file_type: "image/png",
    file_url: `${owner}/${id}.png`,
  });
  const f = fixture(source);
  const blob = await f.read();
  assert.equal(blob.type, "image/png");
  assert.deepEqual(
    f.calls.filter((call) => ["read", "image", "fetch"].includes(call[0])).map((call) => call[0]),
    ["read", "image", "fetch"],
  );
  const invalid = fixture(source);
  invalid.state.fetch = async () =>
    new Response("<script>unsafe</script>", { headers: { "Content-Type": "text/html" } });
  await assert.rejects(invalid.read(), /image response was invalid/);
  const large = fixture(source);
  large.state.fetch = async () =>
    new Response("bytes", {
      headers: { "Content-Type": "image/png", "Content-Length": String(9 * 1024 * 1024) },
    });
  await assert.rejects(large.read(), /response_too_large/);
  assert.equal(large.downloads.length, 0);
});

function dialogFixture(snapshot) {
  const hooks = createHookHarness(),
    calls = [];
  const state = { current: true, request: deferred(), closed: 0 };
  const component = loadUiModule(
    "src/components/LibrarySelectedDownloadsDialog.tsx",
    {
      react: hooks.react,
      "lucide-react": { Download: "Download", Loader2: "Loader2" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": Object.fromEntries(
        ["Dialog", "DialogContent", "DialogTitle", "DialogDescription"].map((name) => [name, name]),
      ),
      "@/lib/library-selected-downloads": {
        SELECTED_LIBRARY_DOWNLOAD_LIMIT: 20,
        startSelectedLibraryDownload: (...args) => {
          calls.push(args);
          return state.request.promise;
        },
      },
    },
    { AbortController, Error },
  );
  const props = {
    snapshot,
    owner,
    isCurrent: () => state.current,
    onClose: () => state.closed++,
    onCloseAutoFocus() {},
  };
  const render = () => hooks.render(component.LibrarySelectedDownloadsDialog, props);
  const button = (title) =>
    elements(
      render(),
      (node) => node.type === "Button" && node.props["aria-label"]?.includes(title),
    )[0];
  return { hooks, state, calls, render, button };
}

function sampleSnapshot() {
  const { helper } = fixture();
  return helper.selectedLibraryDownloadSnapshot(
    [id, second],
    [makeItem(), makeItem({ id: second, title: "Second" })],
    owner,
  );
}

test("dialog starts nothing on open and serializes repeated clicks and different rows", async () => {
  const f = dialogFixture(sampleSnapshot());
  assert.match(text(f.render()), /2 selected · 2 eligible · 0 unsupported/);
  assert.equal(f.calls.length, 0);
  const first = f.button("Research"),
    next = f.button("Second");
  first.props.onClick();
  first.props.onClick();
  next.props.onClick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.button("Second").props.disabled, true);
  assert.doesNotMatch(text(f.render()), /Download started$/);
  f.state.request.resolve();
  await settle();
  assert.match(text(f.render()), /Download started/);
  assert.equal(f.button("Second").props.disabled, false);
  f.hooks.unmount();
});

for (const outcome of ["success", "failure"])
  test(`explicit download activation focuses stable status; delayed ${outcome} cannot steal later focus`, async () => {
    const f = dialogFixture(sampleSnapshot());
    let active = "button";
    const focused = [];
    const status = {
      focus() {
        active = status;
        focused.push(status);
      },
    };
    const rowStatus = elements(f.render(), (node) => node.props.role === "status")[0];
    assert.equal(rowStatus.props.tabIndex, -1);
    rowStatus.props.ref(status);
    f.button("Research").props.onClick();
    assert.equal(active, status);
    assert.equal(focused.length, 1);
    active = "later-control";
    if (outcome === "success") f.state.request.resolve();
    else f.state.request.reject(new Error("Download failed"));
    await settle();
    f.render();
    assert.equal(active, "later-control");
    assert.equal(focused.length, 1);
    f.hooks.unmount();
  });

test("per-file failure remains visible while another succeeds; only explicit retry reattempts", async () => {
  const f = dialogFixture(sampleSnapshot());
  f.button("Research").props.onClick();
  f.state.request.reject(new Error("Access changed. Refresh Library."));
  await settle();
  assert.match(text(f.render()), /Access changed/);
  assert.equal(f.calls.length, 1);
  assert.match(f.button("Research").props["aria-label"], /Retry download/);
  f.state.request = deferred();
  f.button("Second").props.onClick();
  f.state.request.resolve();
  await settle();
  assert.match(text(f.render()), /Access changed/);
  assert.match(text(f.render()), /Download started/);
  assert.equal(f.calls.length, 2);
  f.hooks.unmount();
});

for (const reason of ["close", "unmount", "owner-or-route"])
  test(`dialog ignores late results after ${reason}`, async () => {
    const f = dialogFixture(sampleSnapshot());
    f.button("Research").props.onClick();
    if (reason === "close")
      elements(f.render(), (node) => node.type === "Dialog")[0].props.onOpenChange(false);
    if (reason === "unmount") f.hooks.unmount();
    if (reason === "owner-or-route") f.state.current = false;
    if (reason !== "owner-or-route") assert.equal(f.calls[0][2].aborted, true);
    f.state.request.resolve();
    await settle();
    assert.equal(
      elements(f.render(), (node) => node.props.role === "status").some(
        (node) => text(node) === "Download started",
      ),
      false,
    );
  });

test("over-limit dialog exposes the full selected count and no file download controls", () => {
  const f = dialogFixture({
    count: 25,
    overLimit: true,
    entries: [],
    eligibleCount: 0,
    unsupportedCount: 0,
  });
  assert.match(text(f.render()), /25 items selected. Choose up to 20/);
  assert.equal(
    elements(f.render(), (node) => node.props["aria-label"]?.startsWith("Download ")).length,
    0,
  );
  assert.equal(f.calls.length, 0);
  f.hooks.unmount();
});

const routeSource = readFileSync("src/routes/library.tsx", "utf8");
const ast = ts.createSourceFile(
  "library.tsx",
  routeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
const walk = (node) => {
  nodes.push(node);
  ts.forEachChild(node, walk);
};
walk(ast);
const handler = (name, marker) =>
  nodes
    .find(
      (node) =>
        ts.isJsxAttribute(node) &&
        node.name.getText(ast) === name &&
        node.getText(ast).includes(marker),
    )
    .initializer.expression.getText(ast);
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));

test("selection Download captures without clearing selection; focus returns only to the valid opener", () => {
  const focus = [];
  class Element {
    constructor() {
      this.isConnected = true;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
    contains(value) {
      return value === this.child;
    }
    focus() {
      focus.push(this);
    }
  }
  for (const change of [
    "none",
    "owner",
    "generation",
    "route",
    "later-focus",
    "detached",
    "hidden",
    "disabled",
    "inert",
    "cleared",
  ]) {
    const trigger = new Element(),
      window = { location: { href: "https://kova.test/library" } },
      document = { body: new Element(), activeElement: null };
    document.activeElement = document.body;
    let target;
    const deps = {
      principal: owner,
      principalReady: true,
      libraryCleared: false,
      selected: [id],
      items: [makeItem()],
      userKey: owner,
      window,
      document,
      HTMLElement: Element,
      lifecycleGenerationRef: { current: 1 },
      principalRef: { current: owner },
      ownerIdRef: { current: owner },
      downloadOriginRef: { current: null },
      setDownloadTarget: (value) => (target = value),
      selectedLibraryDownloadSnapshot: fixture().helper.selectedLibraryDownloadSnapshot,
      restoreDialogFocus: loadUiModule("src/lib/dialog-return-focus.ts", {}, { window })
        .restoreDialogFocus,
    };
    compile(
      `return (${handler("onClick", "selectedLibraryDownloadSnapshot")});`,
      deps,
    )({ currentTarget: trigger });
    assert.deepEqual(deps.selected, [id]);
    assert.equal(target.trigger, trigger);
    deps.downloadTarget = target;
    if (change === "owner") deps.ownerIdRef.current = "other";
    if (change === "generation") deps.lifecycleGenerationRef.current++;
    if (change === "route") window.location.href += "?other";
    if (change === "later-focus") document.activeElement = new Element();
    if (change === "detached") trigger.isConnected = false;
    if (["hidden", "disabled", "inert"].includes(change)) trigger[change] = true;
    if (change === "cleared") deps.libraryCleared = true;
    focus.length = 0;
    compile(
      `return (${handler("onCloseAutoFocus", "const origin = downloadOriginRef.current")});`,
      deps,
    )({ preventDefault() {}, target: new Element() });
    assert.equal(focus.length, change === "none" ? 1 : 0, change);
  }
});
