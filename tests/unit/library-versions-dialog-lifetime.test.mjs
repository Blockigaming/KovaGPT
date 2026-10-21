import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

// Execute the source component with explicit service, lifetime and DOM stubs.
// These checks cover state and callback wiring, not Radix or browser behavior.
const item = {
  id: "item-a",
  title: "Saved notes",
  content_text: "Current draft",
  content_revision: 3,
  content_generation: "text-generation-a",
};
const versions = [
  { kind: "text", revision: 3, current: true, file_name: null },
  { kind: "text", revision: 2, current: false, file_name: null },
];

function fixture(overrides = {}) {
  const hooks = createHookHarness();
  const requests = [],
    reads = [],
    saves = [],
    extractions = [],
    lifetimes = [],
    writes = [],
    downloads = [],
    urls = [],
    timers = [],
    revoked = [],
    callbacks = [];
  const focused = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.children = new Set();
    }
    get ownerDocument() {
      return document;
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
    contains(target) {
      return this.children.has(target);
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
  }
  const window = { location: { href: "https://kova.test/library" } };
  const document = {
    body: new Element("body"),
    activeElement: null,
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        click() {
          downloads.push({ href: this.href, name: this.download });
        },
      };
    },
  };
  document.activeElement = document.body;
  const content = new Element("inspector");
  const heading = new Element("Versions title");
  const editField = new Element("Text editor");
  const keepEditing = new Element("Keep editing");
  const discardAction = new Element("Discard changes");
  const alert = new Element("discard dialog");
  content.children.add(heading);
  content.children.add(editField);
  alert.children.add(keepEditing);
  alert.children.add(discardAction);
  const enqueue = (queue, args) => {
    const pending = deferred();
    queue.push({ args, ...pending });
    return pending.promise;
  };
  const props = {
    ownerId: "owner-a",
    item,
    onClose: () => callbacks.push("close"),
    onUpdated: () => callbacks.push("updated"),
    ...overrides,
  };
  const { LibraryVersionsDialog } = loadUiModule(
    "src/components/LibraryVersionsDialog.tsx",
    {
      react: {
        ...hooks.react,
        useState(initial) {
          const [value, update] = hooks.react.useState(initial);
          return [
            value,
            (next) => {
              writes.push(next);
              update(next);
            },
          ];
        },
      },
      "@/components/ui/dialog": {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogTitle: "DialogTitle",
        DialogDescription: "DialogDescription",
      },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/alert-dialog": Object.fromEntries(
        [
          "AlertDialog",
          "AlertDialogAction",
          "AlertDialogCancel",
          "AlertDialogContent",
          "AlertDialogDescription",
          "AlertDialogFooter",
          "AlertDialogHeader",
          "AlertDialogTitle",
        ].map((name) => [name, name]),
      ),
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
      "@/lib/work-view-lifetime.mjs": {
        createWorkViewLifetime(ownerId, onClear) {
          const controller = new AbortController();
          const life = {
            ownerId,
            controller,
            disposed: false,
            clear() {
              if (controller.signal.aborted) return;
              controller.abort();
              onClear();
            },
            dispose() {
              controller.abort();
              life.disposed = true;
            },
          };
          lifetimes.push(life);
          return life;
        },
      },
      "@/lib/library-items-client": {
        libraryItemsRequest: (...args) => enqueue(requests, args),
      },
      "@/lib/library-original-client": {
        readOriginalLibraryFile: (...args) => enqueue(reads, args),
        saveOriginalLibraryFile: (...args) => enqueue(saves, args),
      },
      "@/lib/document-extraction/client": {
        extractDocumentFile: (...args) => enqueue(extractions, args),
      },
    },
    {
      Error,
      Blob,
      URL: {
        createObjectURL(blob) {
          urls.push(blob);
          return `blob:fixture-${urls.length}`;
        },
        revokeObjectURL: (url) => revoked.push(url),
      },
      document,
      window,
      HTMLElement: Element,
      setTimeout: (callback, delay) => timers.push({ callback, delay }),
    },
  );
  const render = () => {
    const tree = hooks.render(LibraryVersionsDialog, props);
    elements(tree, (node) => node.type === "DialogContent")[0].props.ref.current = content;
    elements(tree, (node) => node.type === "DialogTitle")[0].props.ref.current = heading;
    elements(tree, (node) => node.type === "AlertDialogCancel")[0].props.ref.current = keepEditing;
    return tree;
  };
  const find = (predicate) => {
    const found = elements(render(), predicate);
    assert.equal(found.length, 1);
    return found[0];
  };
  const button = (label) =>
    find(
      (node) =>
        node.type === "Button" && (node.props["aria-label"] === label || text(node) === label),
    );
  const textarea = () => find((node) => node.type === "textarea");
  const saveButton = () => find((node) => node.type === "Button" && !node.props["aria-label"]);
  render();
  return {
    props,
    document,
    window,
    Element,
    content,
    heading,
    editField,
    keepEditing,
    discardAction,
    alert,
    focused,
    requests,
    reads,
    saves,
    extractions,
    lifetimes,
    writes,
    downloads,
    urls,
    timers,
    revoked,
    callbacks,
    render,
    find,
    button,
    textarea,
    saveButton,
    clear: () => lifetimes.at(-1).clear(),
    unmount: () => hooks.unmount(),
    async loaded(value = versions) {
      requests[0].resolve({ supported: true, versions: value });
      await settle();
      return render();
    },
    edit(value) {
      const field = textarea();
      assert.equal(field.props.disabled, false);
      field.props.onChange({ target: { value } });
    },
    chooseFile(file) {
      const field = find((node) => node.type === "input" && node.props.type === "file");
      assert.equal(field.props.disabled, false);
      const target = { files: [file], value: "synthetic-selection" };
      field.props.onChange({ target });
      assert.equal(target.value, "");
    },
  };
}

test("initial version load uses the owner and item generation and unlocks the editor", async () => {
  const f = fixture();
  assert.equal(f.textarea().props.value, "Current draft");
  assert.equal(f.textarea().props.disabled, true);
  assert.equal(f.saveButton().props.disabled, true);
  assert.deepEqual(f.requests[0].args, [
    "owner-a",
    "?id=item-a&generation=text-generation-a&history=1",
    f.lifetimes[0].controller.signal,
  ]);
  await f.loaded();
  assert.equal(f.button("Read version 2").props.disabled, false);
  assert.equal(f.button("Download version 3").props.disabled, false);
  assert.equal(f.textarea().props.disabled, false);
  assert.equal(f.saveButton().props.disabled, false);
  assert.match(text(f.render()), /Version\s+3\s+· Current/);
  f.unmount();
  assert.equal(f.lifetimes[0].disposed, true);
});

for (const failure of ["request", "unsupported", "invalid-list", "too-many"]) {
  test(`initial ${failure} failure shows an error without losing the starting draft`, async () => {
    const f = fixture();
    if (failure === "request") f.requests[0].reject(new Error("History is unavailable."));
    else
      f.requests[0].resolve({
        supported: failure !== "unsupported",
        versions: failure === "invalid-list" ? null : Array(failure === "too-many" ? 51 : 0),
      });
    await settle();
    assert.match(
      text(f.find((node) => node.props.role === "alert")),
      failure === "request" ? /History is unavailable/ : /own generation or output history/,
    );
    assert.equal(f.textarea().props.value, "Current draft");
    assert.equal(f.textarea().props.disabled, false);
    assert.equal(f.saveButton().props.disabled, true);
    assert.deepEqual(f.callbacks, []);
  });
}

test("read success selects its revision and a failed read preserves the edited draft for retry", async () => {
  const f = fixture();
  await f.loaded();
  f.button("Read version 2").props.onClick();
  assert.equal(f.textarea().props.disabled, true);
  assert.equal(f.requests[1].args[1], "?id=item-a&generation=text-generation-a&revision=2");
  f.requests[1].resolve({ content_text: "Earlier text" });
  await settle();
  assert.equal(f.textarea().props.value, "Earlier text");
  assert.match(text(f.render()), /Text from version\s+2/);
  f.edit("Unsaved edits");
  f.button("Read version 3").props.onClick();
  f.requests[2].reject(new Error("Read failed."));
  await settle();
  assert.equal(f.textarea().props.value, "Unsaved edits");
  assert.match(text(f.render()), /Text from version\s+2/);
  assert.equal(text(f.find((node) => node.props.role === "alert")), "Read failed.");
  assert.doesNotMatch(text(f.render()), /Your unsaved text is still here/);
  assert.equal(f.button("Read version 3").props.disabled, false);
  f.button("Read version 3").props.onClick();
  assert.equal(elements(f.render(), (node) => node.props.role === "alert").length, 0);
  f.requests[3].resolve({ content_text: "Current text" });
  await settle();
  assert.equal(f.textarea().props.value, "Current text");
  assert.deepEqual(f.callbacks, []);
});

test("text save uses the original revision, preserves a failed draft, and notifies only on success", async () => {
  const f = fixture();
  await f.loaded();
  f.edit("Replacement draft");
  f.saveButton().props.onClick();
  assert.equal(f.saveButton().props.disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[1].args[3])), {
    operation: "replace_text",
    id: "item-a",
    generation: "text-generation-a",
    revision: 3,
    text: "Replacement draft",
  });
  f.requests[1].reject(new Error("Save failed."));
  await settle();
  assert.equal(f.textarea().props.value, "Replacement draft");
  assert.equal(f.saveButton().props.disabled, false);
  assert.equal(text(f.find((node) => node.props.role === "alert")), "Save failed.");
  assert.match(text(f.render()), /Your unsaved text is still here/);
  assert.match(text(f.render()), /Select and copy anything you want to keep/);
  assert.match(text(f.render()), /Refresh Library, then reopen Versions to check the saved text/);
  assert.doesNotMatch(text(f.render()), /(?:conflict|another editor|revision 4)/i);
  assert.deepEqual(f.callbacks, []);
  f.saveButton().props.onClick();
  assert.doesNotMatch(text(f.render()), /Your unsaved text is still here/);
  f.requests[2].resolve({ ok: true });
  await settle();
  assert.deepEqual(f.callbacks, ["updated"]);
  assert.equal(f.textarea().props.value, "Replacement draft");
  assert.equal(f.saveButton().props.disabled, false);
  assert.doesNotMatch(text(f.render()), /Your unsaved text is still here/);
});

for (const draft of ["Current draft", ""]) {
  test(`failed text save gives no copy-retention guidance for ${draft ? "unchanged" : "empty"} text`, async () => {
    const f = fixture();
    await f.loaded();
    f.edit(draft);
    f.saveButton().props.onClick();
    f.requests[1].reject(new Error("Save failed."));
    await settle();
    assert.equal(text(f.find((node) => node.props.role === "alert")), "Save failed.");
    assert.equal(f.textarea().props.value, draft);
    assert.doesNotMatch(text(f.render()), /Your unsaved text is still here/);
    assert.deepEqual(f.callbacks, []);
  });
}

test("failed-save retention guidance disappears when no unsaved text remains", async () => {
  const f = fixture();
  await f.loaded();
  f.edit("Retain this unsaved draft");
  f.saveButton().props.onClick();
  f.requests[1].reject(new Error("Save failed."));
  await settle();
  assert.match(text(f.render()), /Your unsaved text is still here/);
  f.edit("Current draft");
  assert.doesNotMatch(text(f.render()), /Your unsaved text is still here/);
  assert.equal(text(f.find((node) => node.props.role === "alert")), "Save failed.");
});

for (const outcome of ["success", "error"]) {
  for (const order of ["before", "after"]) {
    test(`a superseded read ${outcome} settling ${order} the current read cannot replace or unlock it`, async () => {
      const f = fixture();
      await f.loaded();
      // Capture both enabled handlers before a render, then start both requests.
      const older = f.button("Read version 2").props.onClick;
      const current = f.button("Read version 3").props.onClick;
      older();
      current();
      const settleOlder = async () => {
        f.writes.length = 0;
        if (outcome === "success") f.requests[1].resolve({ content_text: "Superseded text" });
        else f.requests[1].reject(new Error("Superseded failure"));
        await settle();
        assert.deepEqual(f.writes, []);
      };
      if (order === "before") {
        await settleOlder();
        assert.equal(f.textarea().props.disabled, true);
        assert.equal(f.textarea().props.value, "Current draft");
      }
      f.requests[2].resolve({ content_text: "Latest selected text" });
      await settle();
      if (order === "after") await settleOlder();
      assert.equal(f.textarea().props.value, "Latest selected text");
      assert.equal(f.textarea().props.disabled, false);
      assert.match(text(f.render()), /Text from version\s+3/);
      assert.equal(elements(f.render(), (node) => node.props.role === "alert").length, 0);
      assert.deepEqual(f.callbacks, []);
    });
  }
}

test("close and close-autofocus callbacks are delegated unchanged to the dialog primitives", () => {
  const events = [];
  const callback = (event) => {
    events.push(event);
    event.preventDefault();
  };
  const f = fixture({ onCloseAutoFocus: callback });
  const root = f.find((node) => node.type === "Dialog");
  assert.equal(root.props.open, true);
  root.props.onOpenChange(true);
  assert.deepEqual(f.callbacks, []);
  root.props.onOpenChange(false);
  assert.deepEqual(f.callbacks, ["close"]);
  const content = f.find((node) => node.type === "DialogContent");
  assert.equal(content.props.onCloseAutoFocus, callback);
  const event = new Event("closeAutoFocus", { cancelable: true });
  content.props.onCloseAutoFocus(event);
  assert.equal(events[0], event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(
    fixture().find((node) => node.type === "DialogContent").props.onCloseAutoFocus,
    undefined,
  );
});

test("text and original downloads use stubbed DOM effects only after a successful current read", async () => {
  const original = {
    kind: "original",
    revision: 1,
    generation: "original-generation-a",
    file_name: "document.pdf",
  };
  const f = fixture();
  await f.loaded([...versions, original]);
  f.button("Download version 2").props.onClick();
  f.requests[1].resolve({ content_text: "Downloaded version" });
  await settle();
  assert.equal(await f.urls[0].text(), "Downloaded version");
  assert.deepEqual(f.downloads, [{ href: "blob:fixture-1", name: "Saved notes-v2.txt" }]);
  assert.equal(f.timers[0].delay, 1000);
  f.timers[0].callback();
  assert.deepEqual(f.revoked, ["blob:fixture-1"]);
  f.button("Download version 1").props.onClick();
  assert.deepEqual(f.reads[0].args, [
    "owner-a",
    "item-a",
    "original-generation-a",
    f.lifetimes[0].controller.signal,
  ]);
  f.reads[0].reject(new Error("Original read failed."));
  await settle();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.textarea().props.value, "Current draft");
  assert.equal(f.button("Download version 1").props.disabled, false);
  assert.equal(text(f.find((node) => node.props.role === "alert")), "Original read failed.");
  f.button("Download version 1").props.onClick();
  const blob = new Blob(["fixture-original"]);
  f.reads[1].resolve(blob);
  await settle();
  assert.equal(f.urls[1], blob);
  assert.deepEqual(f.downloads[1], { href: "blob:fixture-2", name: "document.pdf" });
});

test("original replacement keeps a failed selection and saves the extracted text with its generation", async () => {
  const f = fixture({ item: { ...item, original_generation: "original-generation-a" } });
  await f.loaded();
  assert.equal(f.saveButton().props.disabled, true);
  const file = { name: "replacement.docx" };
  f.chooseFile(file);
  assert.equal(f.saveButton().props.disabled, false);
  f.saveButton().props.onClick();
  await settle();
  assert.deepEqual(f.extractions[0].args, [file, f.lifetimes[0].controller.signal]);
  f.extractions[0].reject(new Error("Extraction failed."));
  await settle();
  assert.equal(f.saves.length, 0);
  assert.match(text(f.render()), /replacement.docx/);
  assert.equal(f.saveButton().props.disabled, false);
  f.saveButton().props.onClick();
  await settle();
  f.extractions[1].resolve({ text: "Extracted replacement" });
  await settle();
  assert.deepEqual(f.saves[0].args, [
    "owner-a",
    "item-a",
    file,
    "Extracted replacement",
    f.lifetimes[0].controller.signal,
    "original-generation-a",
  ]);
  f.saves[0].reject(new Error("Original save failed."));
  await settle();
  assert.match(text(f.render()), /replacement.docx/);
  assert.equal(f.saveButton().props.disabled, false);
  assert.equal(text(f.find((node) => node.props.role === "alert")), "Original save failed.");
  assert.deepEqual(f.callbacks, []);
  f.saveButton().props.onClick();
  await settle();
  f.extractions[2].resolve({ text: "Extracted replacement" });
  await settle();
  f.saves[1].resolve({ ok: true });
  await settle();
  assert.deepEqual(f.callbacks, ["updated"]);
});

for (const end of ["clear", "unmount"]) {
  test(`${end} blocks retained action handlers from starting another request`, async () => {
    const f = fixture();
    await f.loaded();
    const read = f.button("Read version 2").props.onClick;
    const save = f.saveButton().props.onClick;
    f[end]();
    f.writes.length = 0;
    read();
    save();
    await settle();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.callbacks, []);
  });

  test(`${end} before the original extractor loads prevents extraction and saving`, async () => {
    const f = fixture({ item: { ...item, original_generation: "original-generation-a" } });
    await f.loaded();
    f.chooseFile({ name: "replacement.pdf" });
    f.saveButton().props.onClick();
    f[end]();
    f.writes.length = 0;
    await settle();
    assert.equal(f.extractions.length, 0);
    assert.equal(f.saves.length, 0);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.callbacks, []);
  });

  for (const phase of [
    "load",
    "read",
    "save",
    "download",
    "original-read",
    "extract",
    "original-save",
  ]) {
    for (const outcome of ["success", "error"]) {
      test(`${end} prevents stale ${phase} ${outcome} from changing state or publishing effects`, async () => {
        const isOriginal = ["extract", "original-save"].includes(phase);
        const f = fixture({
          item: isOriginal ? { ...item, original_generation: "original-generation-a" } : item,
        });
        let pending = f.requests[0];
        let value = { supported: true, versions };
        if (phase !== "load") {
          await f.loaded([
            ...versions,
            {
              kind: "original",
              revision: 1,
              generation: "original-generation-a",
              file_name: "old.pdf",
            },
          ]);
          if (phase === "read" || phase === "download") {
            f.button(`${phase === "read" ? "Read" : "Download"} version 2`).props.onClick();
            pending = f.requests[1];
            value = { content_text: "Stale private text" };
          } else if (phase === "save") {
            f.edit("Unsaved draft");
            f.saveButton().props.onClick();
            pending = f.requests[1];
            value = { ok: true };
          } else if (phase === "original-read") {
            f.button("Download version 1").props.onClick();
            pending = f.reads[0];
            value = new Blob(["Stale original"]);
          } else {
            f.chooseFile({ name: "replacement.pdf" });
            f.saveButton().props.onClick();
            await settle();
            pending = f.extractions[0];
            value = { text: "Stale extracted text" };
            if (phase === "original-save") {
              pending.resolve(value);
              await settle();
              pending = f.saves[0];
              value = { ok: true };
            }
          }
        }
        f[end]();
        assert.equal(f.lifetimes[0].controller.signal.aborted, true);
        if (end === "clear") {
          assert.match(text(f.render()), /saved data was cleared/);
          assert.equal(elements(f.render(), (node) => node.type === "textarea").length, 0);
          assert.equal(elements(f.render(), (node) => node.type === "Button").length, 0);
        } else assert.equal(f.lifetimes[0].disposed, true);
        f.writes.length = 0;
        if (outcome === "success") pending.resolve(value);
        else pending.reject(new Error("Stale failure"));
        await settle();
        assert.deepEqual(f.writes, []);
        assert.deepEqual(f.callbacks, []);
        assert.deepEqual(f.downloads, []);
        assert.deepEqual(f.urls, []);
        if (phase === "extract") assert.equal(f.saves.length, 0);
      });
    }
  }
}

test("a keyed owner replacement starts clean and the disposed dialog cannot notify the new owner", async () => {
  const first = fixture();
  await first.loaded();
  first.edit("Owner A private edit");
  first.saveButton().props.onClick();
  first.unmount();
  const next = fixture({
    ownerId: "owner-b",
    item: {
      ...item,
      id: "item-b",
      content_text: "Owner B text",
      content_generation: "text-generation-b",
    },
  });
  assert.equal(next.requests[0].args[0], "owner-b");
  assert.equal(next.textarea().props.value, "Owner B text");
  first.writes.length = 0;
  first.requests[1].resolve({ ok: true });
  await settle();
  assert.deepEqual(first.writes, []);
  assert.deepEqual(first.callbacks, []);
  assert.deepEqual(next.callbacks, []);
  assert.equal(next.textarea().props.value, "Owner B text");
  assert.equal(next.textarea().props.disabled, true);
  await next.loaded();
  assert.equal(next.textarea().props.disabled, false);
});

test("Versions uses the shared inspector and a fixed title with its own scroll body", () => {
  const f = fixture();
  const content = f.find((node) => node.type === "DialogContent");
  assert.equal(content.props.className, "spec400-library-inspector");
  assert.equal(content.props.closeLabel, "Close versions");
  assert.ok(f.find((node) => node.type === "header").props.className.includes("shrink-0"));
  assert.ok(f.find((node) => node.props.className?.includes("spec400-inspector-body")));
});

for (const kind of ["text", "file"]) {
  test(`dirty ${kind} dismissal offers safe Keep editing and retains the draft`, async () => {
    const f = fixture(
      kind === "file" ? { item: { ...item, original_generation: "original-a" } } : {},
    );
    await f.loaded();
    if (kind === "text") f.edit("Unsaved private text");
    else f.chooseFile({ name: "replacement.docx" });
    f.document.activeElement = f.editField;
    f.find((node) => node.type === "Dialog").props.onOpenChange(false);
    assert.deepEqual(f.callbacks, []);
    assert.equal(f.find((node) => node.type === "AlertDialog").props.open, true);
    const confirmation = f.find((node) => node.type === "AlertDialogContent");
    confirmation.props.onOpenAutoFocus({ preventDefault() {} });
    assert.equal(f.document.activeElement, f.keepEditing);
    f.find((node) => node.type === "AlertDialog").props.onOpenChange(false);
    confirmation.props.onCloseAutoFocus({ preventDefault() {}, target: f.alert });
    assert.equal(f.document.activeElement, f.editField);
    assert.deepEqual(f.callbacks, []);
    assert.equal(f.find((node) => node.type === "AlertDialog").props.open, false);
    if (kind === "text") assert.equal(f.textarea().props.value, "Unsaved private text");
    else assert.match(text(f.render()), /replacement.docx/);
    f.find((node) => node.type === "Dialog").props.onOpenChange(false);
    assert.equal(f.find((node) => node.type === "AlertDialog").props.open, true);
  });
}

test("Discard waits for the nested focus scope to close before returning the exact outer opener", async () => {
  let f;
  const events = [];
  const opener = { focus: () => events.push("exact opener") };
  f = fixture({
    onClose() {
      events.push("close");
      assert.equal(f.document.activeElement, f.heading);
      f.find((node) => node.type === "DialogContent").props.onCloseAutoFocus({
        preventDefault() {},
      });
    },
    onCloseAutoFocus(event) {
      event.preventDefault();
      opener.focus();
    },
  });
  await f.loaded();
  f.edit("Unsaved private text");
  f.document.activeElement = f.editField;
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  f.document.activeElement = f.discardAction;
  f.find((node) => node.type === "AlertDialogAction").props.onClick({
    preventDefault() {
      assert.fail("valid discard was blocked");
    },
  });
  assert.deepEqual(events, []);
  f.find((node) => node.type === "AlertDialog").props.onOpenChange(false);
  f.find((node) => node.type === "AlertDialogContent").props.onCloseAutoFocus({
    preventDefault() {},
    target: f.alert,
  });
  assert.deepEqual(events, ["close", "exact opener"]);
});

test("unchanged text and reverted edits close without a discard prompt", async () => {
  for (const reverted of [false, true]) {
    const f = fixture();
    await f.loaded();
    if (reverted) {
      f.edit("Changed");
      f.edit(item.content_text);
    }
    f.find((node) => node.type === "Dialog").props.onOpenChange(false);
    assert.deepEqual(f.callbacks, ["close"]);
    assert.equal(f.find((node) => node.type === "AlertDialog").props.open, false);
  }
});

test("reading a saved version is harmless until its text is edited", async () => {
  const f = fixture();
  await f.loaded();
  f.button("Read version 2").props.onClick();
  f.requests[1].resolve({ content_text: "Earlier saved text" });
  await settle();
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  assert.deepEqual(f.callbacks, ["close"]);
  assert.equal(f.find((node) => node.type === "AlertDialog").props.open, false);
});

for (const interruption of ["account", "clear", "unmount", "navigation", "later-focus"]) {
  test(`pending discard cannot close or steal focus after ${interruption}`, async () => {
    const f = fixture();
    await f.loaded();
    f.edit("Owner A private edit");
    f.document.activeElement = f.editField;
    const close = f.find((node) => node.type === "Dialog").props.onOpenChange;
    const save = f.saveButton().props.onClick;
    close(false);
    const action = f.find((node) => node.type === "AlertDialogAction").props.onClick;
    const confirmation = f.find((node) => node.type === "AlertDialogContent");
    f.document.activeElement = f.discardAction;
    if (interruption === "account") {
      f.props.ownerId = "owner-b";
      f.props.item = {
        ...item,
        id: "item-b",
        content_generation: "generation-b",
        content_text: "Owner B text",
      };
      f.render();
      f.render();
      assert.equal(f.textarea().props.value, "Owner B text");
      assert.equal(f.find((node) => node.type === "AlertDialog").props.open, false);
      save();
      close(false);
      assert.equal(f.requests.length, 2);
    }
    if (interruption === "clear") f.clear();
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?other";
    if (interruption === "later-focus") f.document.activeElement = new f.Element("later input");
    action({ preventDefault() {} });
    confirmation.props.onCloseAutoFocus({ preventDefault() {}, target: f.alert });
    assert.deepEqual(f.focused, []);
    assert.deepEqual(f.callbacks, []);
  });
}

test("pending saves block dismissal and repeat mutation until the result is known", async () => {
  const f = fixture();
  await f.loaded();
  f.edit("Save me");
  const save = f.saveButton().props.onClick;
  save();
  save();
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  let prevented = 0;
  const content = f.find((node) => node.type === "DialogContent");
  content.props.onEscapeKeyDown({
    preventDefault() {
      prevented++;
    },
  });
  content.props.onInteractOutside({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 2);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.callbacks, []);
  f.requests[1].reject(new Error("Save failed."));
  await settle();
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  assert.equal(f.find((node) => node.type === "AlertDialog").props.open, true);
});

test("discarding a replacement file closes without extraction or a mutation", async () => {
  const f = fixture({ item: { ...item, original_generation: "original-a" } });
  await f.loaded();
  f.chooseFile({ name: "replacement.pdf" });
  f.document.activeElement = f.editField;
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  f.document.activeElement = f.discardAction;
  f.find((node) => node.type === "AlertDialogAction").props.onClick({ preventDefault() {} });
  f.find((node) => node.type === "AlertDialog").props.onOpenChange(false);
  f.find((node) => node.type === "AlertDialogContent").props.onCloseAutoFocus({
    preventDefault() {},
    target: f.alert,
  });
  assert.deepEqual(f.callbacks, ["close"]);
  assert.equal(f.extractions.length, 0);
  assert.equal(f.saves.length, 0);
  assert.equal(f.requests.length, 1);
});

test("retained text edit callbacks cannot write into a replacement account", async () => {
  const f = fixture();
  await f.loaded();
  const edit = f.textarea().props.onChange;
  f.props.ownerId = "owner-b";
  f.props.item = {
    ...item,
    id: "item-b",
    content_text: "Owner B text",
    content_generation: "generation-b",
  };
  f.render();
  edit({ target: { value: "Stale owner A text" } });
  assert.equal(f.textarea().props.value, "Owner B text");
});
