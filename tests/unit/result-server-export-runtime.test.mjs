import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  text,
} from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/document-export-policy.mjs";

const common = loadUiModule("src/lib/writing-export/common.ts", {});
const primitives = new Proxy({}, { get: (_target, name) => name });
function fixture({ kind = "writing", prepare } = {}) {
  const hooks = createHookHarness(),
    calls = [],
    timers = new Map();
  let nextTimer = 0,
    current = true;
  const realPrepare = loadUiModule(
    "src/lib/writing-export/server-delivery.ts",
    {
      "./common": common,
      "../document-export-policy.mjs": policy,
      "./export": {
        createDocumentFile: async (format, title, content) => {
          calls.push(["generate", format, title, content]);
          return { bytes: new Uint8Array([37, 80, 68, 70, 45, 0, 255]) };
        },
      },
    },
    { TextEncoder },
  ).prepareServerDocument;
  const { ResultServerExportDialog } = loadUiModule(
    "src/components/ResultServerExportDialog.tsx",
    {
      react: hooks.react,
      "@/components/ui/select": {
        Select: "Select",
        SelectContent: "SelectContent",
        SelectItem: "SelectItem",
        SelectTrigger: "SelectTrigger",
        SelectValue: "SelectValue",
      },
      "./ui/dialog": primitives,
      "@/lib/document-export-policy.mjs": policy,
      "@/lib/writing-export/server-delivery": {
        prepareServerDocument: (...args) => {
          calls.push(["prepare", ...args]);
          return (prepare ?? realPrepare)(...args);
        },
      },
    },
    {
      setTimeout: (fn) => {
        timers.set(++nextTimer, fn);
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
      Error,
    },
  );
  const props = {
    title: "Café / report",
    content: "# Exact draft\r\n\n  Café 🙂\t",
    kind,
    isCurrent: () => current,
    onClose: () => calls.push(["close"]),
    onCloseAutoFocus: () => calls.push(["return-focus"]),
  };
  const render = () => hooks.render(ResultServerExportDialog, props);
  const find = (predicate) => elements(render(), predicate)[0];
  const button = (name) => find((node) => node.type === "button" && text(node) === name);
  const form = () => find((node) => node.type === "form");
  const fields = () =>
    Object.fromEntries(
      elements(form(), (node) => node.type === "input").map((node) => [
        node.props.name,
        node.props.value,
      ]),
    );
  const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
    render();
  };
  const prepareFile = async () => {
    button("Prepare file locally").props.onClick();
    await flush();
  };
  render();
  render();
  return {
    calls,
    props,
    render,
    find,
    button,
    form,
    fields,
    prepareFile,
    flush,
    timers,
    stale: () => {
      current = false;
    },
    unmount: () => hooks.unmount(),
    tick: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

test("explicit alternative discloses processing and does not transmit or prepare on opening", async () => {
  for (const kind of ["writing", "website", "code"]) {
    const f = fixture({ kind });
    assert.match(text(f.render()), /sends a copy.*processed in memory/s);
    assert.match(text(f.render()), /not saved to your account/);
    assert.match(text(f.render()), /new tab.*original draft stays here/s);
    assert.equal(f.form(), undefined);
    assert.deepEqual(f.calls, []);
    await f.prepareFile();
    const expectedFormat = kind === "writing" ? "md" : kind === "website" ? "html" : "txt";
    assert.equal(f.fields().format, expectedFormat);
    assert.equal(f.fields().filename, `Café  report.${expectedFormat}`);
    assert.equal(Buffer.from(f.fields().bytes, "base64url").toString("utf8"), f.props.content);
    assert.deepEqual(Object.keys(f.fields()), ["format", "filename", "bytes"]);
    assert.equal(f.props.content, "# Exact draft\r\n\n  Café 🙂\t");
  }
});

test("real native POST is separate from preparation, retains Origin, and clears payload after submission", async () => {
  const f = fixture();
  await f.prepareFile();
  const form = f.form();
  assert.equal(form.props.action, "/api/document-export");
  assert.equal(form.props.method, "post");
  assert.equal(form.props.target, "_blank");
  assert.equal(form.props.rel, "noopener");
  assert.equal(form.props.encType, "application/x-www-form-urlencoded");
  assert.equal(form.props.referrerPolicy, undefined);
  let prevented = 0;
  form.props.onSubmit({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 0, "Browser default submission is used");
  assert.ok(f.form(), "Payload remains until native serialization");
  form.props.onSubmit({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1, "Double activation does not send twice");
  f.tick();
  assert.equal(f.form(), undefined);
  assert.equal(elements(f.render(), (node) => node.type === "input").length, 0);
  assert.match(text(f.render()), /Download requested/);
  assert.doesNotMatch(text(f.render()), /Document exported|saved successfully/i);
  await f.prepareFile();
  assert.ok(f.form(), "An explicit retry can prepare the same exact draft");
});

test("PDF selection uses the existing real-byte generation seam without automatic delivery", async () => {
  const f = fixture();
  f.find((node) => node.type === "Select").props.onValueChange("pdf");
  f.render();
  await f.prepareFile();
  assert.deepEqual(
    f.calls.find((call) => call[0] === "generate"),
    ["generate", "pdf", f.props.title, f.props.content],
  );
  assert.equal(f.fields().filename, "Café  report.pdf");
  assert.deepEqual([...Buffer.from(f.fields().bytes, "base64url")], [37, 80, 68, 70, 45, 0, 255]);
  assert.equal(f.timers.size, 0);
});

test("editing or changing format invalidates prepared fields and stale form handlers", async () => {
  for (const change of ["content", "title", "format"]) {
    const f = fixture();
    await f.prepareFile();
    const old = f.form();
    if (change === "format") f.find((node) => node.type === "Select").props.onValueChange("pdf");
    else f.props[change] += " changed";
    f.render();
    f.render();
    assert.equal(f.form(), undefined);
    let prevented = false;
    old.props.onSubmit({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
});

test("owner/document/route cancellation and unmount prevent generation completion and submission", async () => {
  for (const cancel of ["stale", "unmount", "edit"]) {
    const job = deferred(),
      f = fixture({ prepare: () => job.promise });
    f.button("Prepare file locally").props.onClick();
    const oldButton = f.find(
      (node) => node.type === "button" && text(node) === "Preparing locally…",
    );
    assert.equal(oldButton.props.disabled, true);
    oldButton.props.onClick();
    assert.equal(f.calls.filter((call) => call[0] === "prepare").length, 1);
    if (cancel === "edit") {
      f.props.content = "New draft";
      f.render();
    } else f[cancel]();
    job.resolve({ format: "md", filename: "old.md", bytes: "b2xk" });
    await f.flush();
    assert.equal(f.form(), undefined);
  }
  for (const cancel of ["stale", "unmount"]) {
    const f = fixture();
    await f.prepareFile();
    const old = f.form();
    f[cancel]();
    let prevented = false;
    old.props.onSubmit({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(f.timers.size, 0);
  }
});

test("preparation failure preserves the draft, stays readable, and retries explicitly", async () => {
  let tries = 0;
  const f = fixture({
    prepare: async () => {
      if (!tries++) throw Error("PDF fonts could not be loaded");
      return { format: "md", filename: "draft.md", bytes: "" };
    },
  });
  await f.prepareFile();
  const alert = f.find((node) => node.props.role === "alert");
  assert.match(text(alert), /PDF fonts could not be loaded.*draft is preserved/);
  assert.match(alert.props.className, /text-foreground/);
  assert.equal(f.form(), undefined);
  await f.prepareFile();
  assert.ok(f.form());
});

test("Close and Escape use the guarded close/focus callbacks; unmount clears pending cleanup", async () => {
  const f = fixture();
  f.button("Close").props.onClick();
  f.find((node) => node.type === "Dialog").props.onOpenChange(false);
  f.find((node) => node.type === "DialogContent").props.onCloseAutoFocus({});
  assert.deepEqual(f.calls, [["close"], ["close"], ["return-focus"]]);
  await f.prepareFile();
  f.form().props.onSubmit({ preventDefault: () => assert.fail() });
  assert.equal(f.timers.size, 1);
  f.unmount();
  assert.equal(f.timers.size, 0);
  f.button("Close").props.onClick();
  assert.equal(f.calls.filter((call) => call[0] === "close").length, 2);
});

test("existing local Office export keeps its bytes, MIME, filename and last-moment scope gate", async () => {
  const downloads = [],
    generated = new Uint8Array([1, 2, 3]);
  const deps = { "./common": { ...common, downloadBytes: (...args) => downloads.push(args) } };
  for (const format of ["pdf", "docx", "xlsx", "pptx"]) {
    const name = `createDocument${format === "pdf" ? "Pdf" : format === "docx" ? "Docx" : format === "xlsx" ? "Xlsx" : "Pptx"}`;
    deps[`./${format}`] = { [name]: async () => generated };
  }
  const { downloadDocument } = loadUiModule("src/lib/writing-export/export.ts", deps);
  assert.equal(await downloadDocument("pdf", "Title", "Content", () => false), false);
  assert.equal(downloads.length, 0);
  assert.equal(await downloadDocument("pdf", "Title", "Content"), true);
  assert.equal(downloads[0][0], generated);
  assert.deepEqual(downloads[0].slice(1), ["application/pdf", "Title.pdf"]);
});
