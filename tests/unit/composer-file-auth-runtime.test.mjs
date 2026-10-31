import * as pdfMetadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import * as localAttachments from "../../src/lib/composer-local-attachments.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("src/components/ChatInput.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);

// Actual composer callbacks with inert hooks and browser/service doubles. No
// chooser, user file, auth navigation, provider call, upload or quota is real.
function fixture(
  initial = {},
  initialAccount = { isLoaded: true, user: null },
  initialLayout = { isDesktop: true, isMobile: false, interaction: "pointer" },
  documentResult,
) {
  let account = initialAccount,
    cursor = 0,
    tree,
    dirty = true,
    nextId = 0;
  const hooks = [],
    reads = [],
    saves = [],
    quotas = [],
    changes = [],
    attachmentChanges = [],
    choosers = [],
    submissions = [],
    submittedTools = [],
    toolChanges = [];
  const scopes = new Map();
  let props = {
    value: "Keep my draft",
    attachments: [],
    isStreaming: false,
    showAddMenu: true,
    onChange: (value) => {
      changes.push(value);
      props.value = value;
      dirty = true;
    },
    onAttachmentsChange: (value) => {
      attachmentChanges.push(value);
      props.attachments = value;
      dirty = true;
    },
    onSubmit: (tool) => {
      submissions.push(true);
      submittedTools.push(tool);
    },
    onStop() {},
    onToolSelect: (tool) => {
      toolChanges.push(tool);
      props.selectedTool = tool;
      dirty = true;
    },
    ...initial,
  };
  const react = {
    useRef(value) {
      const index = cursor++;
      hooks[index] ??= { current: value };
      return hooks[index];
    },
    useState(value) {
      const index = cursor++;
      hooks[index] ??= { value };
      return [
        hooks[index].value,
        (next) => {
          hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
          dirty = true;
        },
      ];
    },
    useEffect() {},
    useSyncExternalStore: () => true,
    lazy: (loader) => String(loader).match(/Composer[A-Za-z]+/)?.[0] ?? "Lazy",
    Suspense: "Suspense",
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    "@/lib/document-extraction/client": {
      extractDocumentFile: async () => {
        reads.push("document reader");
        if (documentResult instanceof Error) throw documentResult;
        return documentResult;
      },
    },
    "@/lib/document-extraction/pdf-metadata.mjs": pdfMetadata,
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": {},
    "@tanstack/react-router": {
      useNavigate: () => () => {
        throw new Error("Unexpected navigation");
      },
    },
    "@/components/auth/ClerkSafe": { useUser: () => account, SignInButton: "SignInButton" },
    "@/hooks/use-mobile": {
      useLayout: () => initialLayout,
    },
    "@/lib/composer-local-attachments.mjs": localAttachments,
    "@/lib/composer-preferences": { useSharedSendOnEnter: () => true },
    "@/lib/limits": {
      tryUseUpload: (limit) => {
        quotas.push(limit);
        return true;
      },
    },
    "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 2 } },
    "@/lib/composer-keyboard.mjs": {},
    "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
    "@/lib/composer-paste": { prepareComposerPaste: (plain) => plain },
    sonner: { toast: { error() {}, message() {} } },
    "@/hooks/use-library-attachment-auto-save": {
      useLibraryAttachmentAutoSave: () => {
        const principal = account.user?.id ?? "guest";
        if (!scopes.has(principal)) scopes.set(principal, { principal });
        return { scope: scopes.get(principal), save: (...args) => saves.push(args) };
      },
    },
  };
  for (const name of [
    "ComposerVoiceDialog",
    "ComposerUploadAllowance",
    "ComposerPdfPages",
    "ComposerContextPanel",
    "ComposerModelStatus",
    "MobileBottomSheet",
    "ResponsiveModelSelector",
    "ComposerDrawingDialog",
    "ComposerPluginList",
  ])
    modules[`@/components/${name}`] = { [name]: name };
  for (const [module, names] of [
    ["dialog", ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"]],
    ["popover", ["Popover", "PopoverContent", "PopoverTrigger"]],
    ["select", ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]],
  ])
    modules[`@/components/ui/${module}`] = Object.fromEntries(names.map((name) => [name, name]));
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
    window: {
      location: { href: "https://local.test/chat/unchanged" },
      requestAnimationFrame: (run) => run(),
    },
    crypto: { randomUUID: () => `synthetic-${++nextId}` },
    TextEncoder,
    AbortController,
    DOMException,
    Error,
    Set,
    Map,
    Date,
    Promise,
    FileReader: class {
      constructor() {
        reads.push("image reader");
      }
    },
  });
  const targets = new Map();
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports.ChatInput(props);
    for (const node of nodes(tree))
      if (node.props.ref && typeof node.props.ref === "object") {
        const label = node.props["aria-label"] ?? node.type;
        if (!targets.has(label))
          targets.set(label, {
            focus() {},
            click: () => choosers.push(label),
            selectionStart: 0,
            selectionEnd: 0,
          });
        node.props.ref.current = targets.get(label);
      }
  }
  async function flush() {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate);
      if (dirty) render();
    }
  }
  function button(label) {
    const node = nodes(tree).find(
      (node) =>
        node.type === "button" &&
        typeof node.props.onClick === "function" &&
        (text(node).trim() === label || node.props["aria-label"] === label),
    );
    assert.ok(node, `Missing ${label}`);
    return node.props;
  }
  render();
  return {
    reads,
    saves,
    quotas,
    changes,
    attachmentChanges,
    choosers,
    submissions,
    submittedTools,
    toolChanges,
    nodes: () => nodes(tree),
    root: () => tree.props,
    button,
    flush,
    signIn: () => nodes(tree).find((node) => node.type === "ComposerSignInDialog")?.props,
    drawing: () => nodes(tree).find((node) => node.type === "ComposerDrawingDialog").props,
    offer: () => nodes(tree).find((node) => node.type === "ComposerPasteOffer")?.props,
    input: () => nodes(tree).find((node) => node.type === "textarea").props,
    async click(label) {
      await button(label).onClick();
      await flush();
    },
    async update(next) {
      Object.assign(props, next);
      dirty = true;
      await flush();
    },
    async account(next) {
      account = next;
      dirty = true;
      await flush();
    },
    file() {
      return {
        name: "Private.txt",
        type: "text/plain",
        size: 9,
        text: async () => {
          reads.push("text reader");
          return "File text";
        },
      };
    },
  };
}

for (const entry of [
  "picker",
  "file input",
  "clipboard file",
  "drop",
  "drawing attach",
  "drawing creation",
])
  test(`guests must sign in before ${entry}, with no read, quota, save or draft mutation`, async () => {
    const f = fixture();
    const file = f.file();
    let prevented = false;
    if (entry === "picker") await f.click("Photos & Files");
    if (entry === "file input")
      await f
        .nodes()
        .find((node) => node.type === "input" && node.props["aria-label"] === "Choose files")
        .props.onChange({ target: { files: [file], value: "selected" } });
    if (entry === "clipboard file")
      await f.root().onPaste({
        clipboardData: { files: [file] },
        preventDefault() {
          prevented = true;
        },
      });
    if (entry === "drop")
      await f.root().onDrop({
        dataTransfer: { files: [file] },
        preventDefault() {
          prevented = true;
        },
      });
    if (entry === "drawing attach") assert.equal(await f.drawing().onAttach([file]), false);
    if (entry === "drawing creation") await f.click("Drawings");
    await f.flush();
    assert.ok(f.signIn());
    assert.equal(f.signIn().hasPendingMessage, true);
    assert.ok(f.signIn().returnFocusTarget);
    assert.match(f.signIn().description, /Sign in to upload or create files and images/);
    assert.equal(f.input().value, "Keep my draft");
    assert.deepEqual(
      [f.reads, f.saves, f.quotas, f.changes, f.attachmentChanges, f.choosers],
      [[], [], [], [], [], []],
    );
    assert.equal(f.drawing().open, false);
    if (["drop", "clipboard file"].includes(entry)) assert.equal(prevented, true);
    f.signIn().onClose();
    await f.flush();
    assert.equal(f.signIn(), undefined);
    assert.equal(f.input().value, "Keep my draft");
  });

test("guest pasted-text attachment requires sign-in but ordinary text pasting remains available", async () => {
  const f = fixture({ value: "" });
  let prevented = false;
  const paste = (plain) => ({
    clipboardData: { files: [], getData: (kind) => (kind === "text/plain" ? plain : "") },
    preventDefault() {
      prevented = true;
    },
  });
  await f.root().onPaste(paste("Normal text"));
  assert.equal(prevented, false);
  assert.equal(f.signIn(), undefined);
  await f.root().onPaste(paste("x".repeat(10_001)));
  await f.flush();
  f.button("Inspect pending pasted text").onClick({ currentTarget: {} });
  await f.flush();
  await f.click("Attach text");
  assert.ok(f.signIn());
  assert.equal(f.signIn().hasPendingMessage, true, "The paste offer is also an unsaved draft");
  assert.deepEqual([f.quotas, f.attachmentChanges], [[], []]);
  assert.equal(f.input().value, "");
});

test("signed-in file selection, reads and drawing creation keep working", async () => {
  const f = fixture({}, { isLoaded: true, user: { id: "owner-a" } });
  await f.click("Photos & Files");
  assert.deepEqual(f.choosers, ["Choose files"]);
  assert.equal(await f.drawing().onAttach([f.file()]), true);
  await f.flush();
  assert.deepEqual(f.reads, ["text reader"]);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.saves.length, 1);
  assert.equal(f.signIn(), undefined);
  await f.click("Drawings");
  assert.equal(f.drawing().open, true);
  assert.equal(f.input().value, "Keep my draft");
});

test("loading auth and stale signed-in callbacks cannot start a file operation", async () => {
  const loading = fixture({}, { isLoaded: false, user: null });
  assert.equal(await loading.drawing().onAttach([loading.file()]), false);
  assert.equal(loading.signIn(), undefined);
  assert.deepEqual(loading.reads, []);
  const f = fixture({}, { isLoaded: true, user: { id: "owner-a" } });
  const staleAttach = f.drawing().onAttach;
  await f.account({ isLoaded: true, user: null });
  assert.equal(await staleAttach([f.file()]), false);
  await f.flush();
  assert.deepEqual([f.reads, f.saves, f.quotas], [[], [], []]);
  assert.ok(f.signIn());
});

test("guest attachment or image-tool submission is stopped before sending", async () => {
  for (const extra of [
    { attachments: [{ kind: "text_file", name: "Old.txt", dataUrl: "", status: "complete" }] },
    { selectedTool: "image" },
  ]) {
    const f = fixture(extra);
    await f.click("Send message");
    assert.deepEqual(f.submissions, []);
    assert.ok(f.signIn());
  }
  const f = fixture();
  await f.click("Create Image");
  assert.ok(f.signIn());
  assert.deepEqual(f.toolChanges, []);
});

test("guest phone Photos and Camera require sign-in before the native chooser", async () => {
  for (const action of ["Photos", "Camera", "Files"]) {
    const f = fixture(
      {},
      { isLoaded: true, user: null },
      { isDesktop: false, isMobile: true, interaction: "touch" },
    );
    await f.click(action);
    assert.ok(f.signIn());
    assert.deepEqual(f.choosers, []);
    assert.ok(
      f
        .nodes()
        .filter((node) => node.type === "input" && node.props.type === "file")
        .every((node) => node.props.disabled),
    );
  }
});

test("signed-in pasted-text attachment remains available without replacing the draft", async () => {
  const f = fixture({}, { isLoaded: true, user: { id: "owner-a" } });
  await f.root().onPaste({
    clipboardData: {
      files: [],
      getData: (kind) => (kind === "text/plain" ? "x".repeat(10_001) : ""),
    },
    preventDefault() {},
  });
  await f.flush();
  assert.deepEqual(f.quotas, []);
  assert.equal(f.attachmentChanges.at(-1)[0].name, "pasted-text.txt");
  assert.equal(f.attachmentChanges.at(-1)[0].textContent, "x".repeat(10_001));
  assert.deepEqual(f.saves, []);
  assert.equal(f.input().value, "Keep my draft");
  assert.equal(f.signIn(), undefined);
});

const pageFixture = {
  pageCount: 3,
  pages: [
    { pageNumber: 1, status: "extracted", text: "First page [Page 3] is literal text" },
    { pageNumber: 2, status: "no_text" },
    { pageNumber: 3, status: "extracted", text: "Third page" },
  ],
};
async function inspect(f, name) {
  f.button(`Inspect ${name}`).onClick({ currentTarget: { isConnected: true, focus() {} } });
  await f.flush();
  return f.nodes().find((node) => node.type === "ComposerPdfPages")?.props;
}

test("composer PDF range updates only the sendable text, retains source and restores without resaving or quota charges", async () => {
  const original = pdfMetadata.pdfDocumentText(pageFixture);
  const attachment = {
    clientId: "pdf-1",
    kind: "text_file",
    source: "file_upload",
    name: "Report.pdf.extracted.txt",
    dataUrl: "",
    status: "complete",
    textContent: original,
    pdf: pageFixture,
  };
  const f = fixture({ attachments: [attachment] }, { isLoaded: true, user: { id: "owner-a" } });
  let controls = await inspect(f, attachment.name);
  assert.equal(controls.onSelect("3"), undefined);
  await f.flush();
  const selected = f.attachmentChanges.at(-1)[0];
  assert.match(selected.textContent, /Selected PDF extracted text: pages 3 of 3/);
  assert.doesNotMatch(selected.textContent, /First page/);
  assert.deepEqual(selected.selectedPdfPages, [3]);
  assert.equal(selected.pdf, pageFixture);
  assert.match(controls.onSelect("1"), /no longer available/); // A stale callback cannot edit a newer attachment.
  controls = f.nodes().find((node) => node.type === "ComposerPdfPages").props;
  assert.match(controls.onSelect("2"), /No available extracted text/);
  assert.equal(f.attachmentChanges.at(-1)[0], selected);
  assert.equal(controls.onSelect(null), undefined);
  await f.flush();
  assert.equal(f.attachmentChanges.at(-1)[0].textContent, original);
  assert.equal(f.attachmentChanges.at(-1)[0].selectedPdfPages, undefined);
  assert.deepEqual(f.saves, []);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.input().value, "Keep my draft");
  controls = f.nodes().find((node) => node.type === "ComposerPdfPages").props;
  await f.click(`Remove ${attachment.name}`);
  assert.match(controls.onSelect("1"), /no longer available/);
});

test("historical PDF text without structured metadata never gains inferred count or page controls", async () => {
  const f = fixture(
    {
      attachments: [
        {
          kind: "text_file",
          name: "Historic.pdf.extracted.txt",
          dataUrl: "",
          status: "complete",
          textContent: "[Page 7]\n[No extractable text on this page]",
        },
      ],
    },
    { isLoaded: true, user: { id: "owner-a" } },
  );
  assert.equal(await inspect(f, "Historic.pdf.extracted.txt"), undefined);
  assert.match(text(f.nodes()), /Saved text-only records do not retain PDF page metadata/);
  assert.equal(f.attachmentChanges.length, 0);
});

test("signed-in PDF upload carries real page observations into preview and saves the unchanged original extraction once", async () => {
  const extraction = {
    text: pdfMetadata.pdfDocumentText(pageFixture),
    note: "Parser note",
    pdf: pageFixture,
  };
  const f = fixture({}, { isLoaded: true, user: { id: "owner-a" } }, undefined, extraction);
  const file = { name: "Report.pdf", type: "application/pdf", size: 100 };
  await f
    .nodes()
    .find((node) => node.type === "input" && node.props["aria-label"] === "Choose files")
    .props.onChange({ target: { files: [file], value: "selected" } });
  await f.flush();
  const attachment = f.attachmentChanges.at(-1)[0];
  assert.equal(attachment.status, "complete");
  assert.equal(attachment.pdf, pageFixture);
  assert.equal(attachment.textContent, extraction.text);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0][0].textContent, extraction.text);
  assert.equal(f.saves[0][2], file);
  assert.deepEqual(f.quotas, []); // Local extraction does not change the existing send-time quota path.
  assert.ok(await inspect(f, attachment.name));
});

test("no-text PDF rejection retains observed empty pages, blocks submission and never autosaves", async () => {
  const pdf = { pageCount: 1, pages: [{ pageNumber: 1, status: "no_text" }] };
  const f = fixture(
    {},
    { isLoaded: true, user: { id: "owner-a" } },
    undefined,
    new pdfMetadata.PdfTextUnavailableError(
      "Pages may be blank or scanned. OCR is unavailable.",
      pdf,
    ),
  );
  await f
    .nodes()
    .find((node) => node.type === "input" && node.props["aria-label"] === "Choose files")
    .props.onChange({
      target: {
        files: [{ name: "Empty.pdf", type: "application/pdf", size: 100 }],
        value: "selected",
      },
    });
  await f.flush();
  const attachment = f.attachmentChanges.at(-1)[0];
  assert.equal(attachment.status, "failed");
  assert.equal(attachment.pdf, pdf);
  assert.match(attachment.error, /blank or scanned/);
  assert.equal((await inspect(f, attachment.name)).disabled, true);
  assert.deepEqual(f.saves, []);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.button("Send message").disabled, true);
});

test("all-failed and failed-plus-blank PDF errors retain observations, block sending, and never autosave", async () => {
  for (const statuses of [
    ["failed", "failed"],
    ["failed", "no_text"],
  ]) {
    const pdf = {
      pageCount: 2,
      pages: statuses.map((status, index) => ({ pageNumber: index + 1, status })),
    };
    const f = fixture(
      {},
      { isLoaded: true, user: { id: "owner-a" } },
      undefined,
      new pdfMetadata.PdfTextUnavailableError(
        "No PDF text is available. Some page reads failed; see the page details. OCR is not available.",
        pdf,
      ),
    );
    await f
      .nodes()
      .find((node) => node.type === "input" && node.props["aria-label"] === "Choose files")
      .props.onChange({
        target: {
          files: [{ name: "Synthetic unavailable.pdf", type: "application/pdf", size: 100 }],
          value: "selected",
        },
      });
    await f.flush();
    const attachment = f.attachmentChanges.at(-1)[0];
    assert.equal(attachment.status, "failed");
    assert.equal(attachment.pdf, pdf);
    assert.match(attachment.error, /page reads failed/);
    assert.equal(attachment.textContent, undefined);
    assert.equal((await inspect(f, attachment.name)).disabled, true);
    assert.deepEqual(f.saves, []);
    assert.deepEqual(f.quotas, []);
    assert.equal(f.button("Send message").disabled, true);
  }
});

for (const [label, tool] of [
  ["Analyze data", "data_analysis"],
  ["Analyze files", "file_analysis"],
]) {
  test(`${label} is selectable on desktop and phone and hands the explicit tool to Send`, async () => {
    for (const layout of [
      { isDesktop: true, isMobile: false, interaction: "pointer" },
      { isDesktop: false, isMobile: true, interaction: "touch" },
    ]) {
      const f = fixture(
        {
          attachments:
            tool === "file_analysis"
              ? [
                  {
                    kind: "text_file",
                    name: "Data.csv",
                    dataUrl: "",
                    status: "complete",
                    textContent: "item,value\napple,3",
                  },
                ]
              : [],
        },
        { isLoaded: true, user: { id: "owner-a" } },
        layout,
      );
      await f.click(label);
      assert.deepEqual(f.toolChanges, [tool]);
      assert.equal(f.button(label)["aria-pressed"], true);
      await f.click("Send message");
      assert.deepEqual(f.submittedTools, [tool]);
      assert.deepEqual([f.quotas, f.saves, f.reads], [[], [], []]);
    }
  });

  test(`guests cannot select or submit ${label}, including a queued draft`, async () => {
    const f = fixture();
    await f.click(label);
    assert.ok(f.signIn());
    assert.deepEqual(f.toolChanges, []);
    const submitted = fixture({ selectedTool: tool });
    await submitted.click("Send message");
    assert.ok(submitted.signIn());
    assert.deepEqual(submitted.submittedTools, []);
    const queued = [];
    const next = fixture({
      selectedTool: tool,
      isStreaming: true,
      onSendNext: (value) => {
        queued.push(value);
        return true;
      },
    });
    await next.click("Send next");
    assert.ok(next.signIn());
    assert.deepEqual(queued, []);
    assert.equal(next.input().value, "Keep my draft");
  });
}

test("Analyze files rejects missing, failed, pending, image and opaque attachments without changing the draft", async () => {
  for (const attachments of [
    [],
    [{ kind: "text_file", name: "Blank.txt", dataUrl: "", status: "complete", textContent: "  " }],
    [
      {
        kind: "text_file",
        name: "Pending.txt",
        dataUrl: "",
        status: "uploading",
        textContent: "data",
      },
    ],
    [{ kind: "text_file", name: "Failed.txt", dataUrl: "", status: "failed", textContent: "data" }],
    [
      {
        kind: "image",
        name: "Photo.png",
        dataUrl: "data:image/png;base64,AAAA",
        status: "complete",
      },
    ],
    [
      {
        kind: "library_file",
        name: "Opaque.pdf",
        dataUrl: "",
        libraryItemId: "file-id",
        status: "complete",
      },
    ],
  ]) {
    const f = fixture(
      { selectedTool: "file_analysis", attachments },
      { isLoaded: true, user: { id: "owner-a" } },
    );
    await f.click("Send message");
    assert.deepEqual(f.submittedTools, []);
    assert.equal(f.input().value, "Keep my draft");
    assert.deepEqual(f.attachmentChanges, []);
    assert.match(text(f.nodes()), /Attach a text file|Wait for|Remove or retry/);
  }
});

test("removing a file also blocks a stale Send callback and queued file analysis", async () => {
  const attachment = {
    kind: "text_file",
    name: "Data.csv",
    dataUrl: "",
    status: "complete",
    textContent: "x,y\n1,2",
  };
  const f = fixture(
    { selectedTool: "file_analysis", attachments: [attachment] },
    { isLoaded: true, user: { id: "owner-a" } },
  );
  const staleSend = f.button("Send message").onClick;
  await f.click("Remove Data.csv");
  staleSend();
  await f.flush();
  assert.deepEqual(f.submittedTools, []);
  assert.match(text(f.nodes()), /Attach a text file/);
  const queued = [];
  const next = fixture(
    {
      selectedTool: "file_analysis",
      attachments: [attachment],
      isStreaming: true,
      onSendNext: (tool) => {
        queued.push(tool);
        return true;
      },
    },
    { isLoaded: true, user: { id: "owner-a" } },
  );
  const staleNext = next.button("Send next").onClick;
  await next.click("Remove Data.csv");
  staleNext();
  await next.flush();
  assert.deepEqual(queued, []);
  await next.update({ attachments: [attachment] });
  await next.click("Send next");
  assert.deepEqual(queued, ["file_analysis"]);
});

test("analysis selection toggles off and data analysis queues without any file or new allowance", async () => {
  const f = fixture({}, { isLoaded: true, user: { id: "owner-a" } });
  await f.click("Analyze data");
  await f.click("Analyze data");
  assert.deepEqual(f.toolChanges, ["data_analysis", null]);
  await f.click("Send message");
  assert.deepEqual(f.submittedTools, [null]);
  const queued = [];
  const next = fixture(
    {
      selectedTool: "data_analysis",
      isStreaming: true,
      onSendNext: (tool) => {
        queued.push(tool);
        return true;
      },
    },
    { isLoaded: true, user: { id: "owner-a" } },
  );
  await next.click("Send next");
  assert.deepEqual(queued, ["data_analysis"]);
  assert.deepEqual([next.quotas, next.saves, next.reads], [[], [], []]);
});

test("stale analysis Send and queued Send callbacks cannot run for a replacement account", async () => {
  const f = fixture({ selectedTool: "data_analysis" }, { isLoaded: true, user: { id: "owner-a" } });
  const staleSend = f.button("Send message").onClick;
  await f.account({ isLoaded: true, user: { id: "owner-b" } });
  staleSend();
  await f.flush();
  assert.deepEqual(f.submittedTools, []);
  await f.click("Send message");
  assert.deepEqual(f.submittedTools, ["data_analysis"]);
  const queued = [];
  const next = fixture(
    {
      selectedTool: "data_analysis",
      isStreaming: true,
      onSendNext: (tool) => {
        queued.push(tool);
        return true;
      },
    },
    { isLoaded: true, user: { id: "owner-a" } },
  );
  const staleNext = next.button("Send next").onClick;
  await next.account({ isLoaded: true, user: { id: "owner-b" } });
  staleNext();
  await next.flush();
  assert.deepEqual(queued, []);
  await next.click("Send next");
  assert.deepEqual(queued, ["data_analysis"]);
});
