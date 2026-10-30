import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (name) => readFileSync(new URL(`../../src/routes/${name}`, import.meta.url), "utf8");
const images = read("images.tsx");
const library = read("library.tsx");
const project = read("projects.$projectId.tsx");
const versions = readFileSync(
  new URL("../../src/components/LibraryVersionsDialog.tsx", import.meta.url),
  "utf8",
);
const management = readFileSync(
  new URL("../../src/styles/spec400-management.css", import.meta.url),
  "utf8",
);

function dialogContents(source) {
  const ast = ts.createSourceFile(
    "surface.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const contents = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "DialogContent") {
      const className = node.openingElement.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "className",
      )?.initializer;
      assert.ok(
        className && ts.isStringLiteral(className),
        "Preview surface has explicit geometry",
      );
      contents.push({ className: className.text, source: node.getText(ast) });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return contents;
}

function imageFixture(status, editDraftDuringRequest = false) {
  const state = { prompt: "", error: null, loading: false, history: [] };
  const source = images.slice(
    images.indexOf("  async function generate(p:"),
    images.indexOf("  const applyPreset"),
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    isSignedIn: true,
    userKey: "owner",
    submittingRef: { current: false },
    generationRef: { current: 0 },
    generationControllerRef: { current: null },
    resultRevealRef: { current: null },
    captureResultReveal() {},
    clearResultReveal() {},
    aspectRatio: "1:1",
    editSelection: null,
    IMAGE_GENERATION_UNAVAILABLE:
      "Image generation is temporarily unavailable. Your prompt is kept here so you can try again later.",
    setPrompt(value) {
      state.prompt = typeof value === "function" ? value(state.prompt) : value;
    },
    setError(value) {
      state.error = value;
    },
    setLoading(value) {
      state.loading = value;
    },
    setLoginOpen() {},
    setLimitOpen() {},
    setLimitMessage() {},
    setResult() {},
    setResultPrompt() {},
    addToHistory(...value) {
      state.history.push(value);
    },
    safeImageUrl: (url) => url,
    async imageApiRequest() {
      if (editDraftDuringRequest) state.prompt = "My next prompt";
      return {
        response: { ok: status === 200, status },
        body:
          status === 200
            ? { imageUrl: "data:image/png;base64,fixture" }
            : { error: "Provider not configured" },
      };
    },
  };
  const generate = new Function(...Object.keys(dependencies), `${javascript}; return generate;`)(
    ...Object.values(dependencies),
  );
  return { state, generate };
}

test("unavailable image generation keeps the submitted prompt and reports availability truthfully", async () => {
  const { state, generate } = imageFixture(503);
  await generate("A watercolor landscape");
  assert.equal(state.prompt, "A watercolor landscape");
  assert.match(state.error, /temporarily unavailable.*prompt is kept/);
  assert.equal(state.loading, false);
  assert.deepEqual(state.history, []);
  assert.match(images, /error === IMAGE_GENERATION_UNAVAILABLE\s*\? IMAGE_GENERATION_UNAVAILABLE/);
});

test("successful image generation does not clear a newer prompt draft", async () => {
  const { state, generate } = imageFixture(200, true);
  await generate("First prompt");
  assert.equal(state.prompt, "My next prompt");
  assert.equal(state.history.length, 1);
});

test("Library shared preview and item/version inspectors keep bounded, padded scroll surfaces", () => {
  const libraryContents = dialogContents(library);
  const versionContents = dialogContents(versions);
  assert.equal(
    libraryContents.length,
    3,
    "Library retains item, shared-snapshot and recovery dialogs",
  );
  const recovery = libraryContents.find(
    (surface) => surface.className === "max-h-[90dvh] overflow-y-auto",
  );
  assert.ok(recovery, "Recovery has its own bounded scrolling surface");
  assert.match(
    recovery.source,
    /<ChatTrashPanel key=\{principal \?\? "guest"\} userKey=\{userKey\}/,
  );
  assert.equal(versionContents.length, 1, "Version history uses its own inspector component");
  const shared = libraryContents.find((surface) => surface.className.startsWith("mx-auto gap-0"));
  assert.ok(shared, "Shared snapshots keep their centered responsive preview");
  assert.match(shared.className, /mx-auto gap-0 overflow-hidden p-0 sm:mx-0/);
  assert.match(shared.className, /sm:w-\[min\(92vw,768px\)\] sm:max-w-3xl/);
  assert.match(shared.source, /visibleSharedPreview.snapshot.messages.map/);
  assert.match(shared.source, /min-h-0 min-w-0 max-h-\[70dvh\][^"\n]*overflow-auto/);
  assert.match(shared.source, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);

  const item = libraryContents.find((surface) => surface.className === "spec400-library-inspector");
  assert.ok(item, "Saved items use the approved viewport inspector");
  for (const inspector of [item, versionContents[0]]) {
    assert.equal(inspector.className, "spec400-library-inspector");
    assert.match(inspector.source, /className="spec400-inspector-body(?:[ "])/);
  }
  assert.match(library, /<LibraryVersionsDialog\s/);
  assert.match(
    item.source,
    /<pre className="max-w-full whitespace-pre-wrap break-words \[overflow-wrap:anywhere\]/,
  );
  const bounds = management.match(
    /body \.spec400-library-inspector\[data-kova-dialog-surface\]\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(bounds);
  assert.match(bounds, /width: 420px !important/);
  assert.match(bounds, /max-width: 100% !important/);
  assert.match(bounds, /height: 100dvh !important/);
  assert.match(bounds, /max-height: 100dvh !important/);
  assert.match(
    management,
    /@media \(max-width: 767px\)\s*\{\s*body \.spec400-library-inspector\[data-kova-dialog-surface\]\s*\{\s*width: 100% !important/,
  );
  const scroll = management.match(/\.spec400-inspector-body\s*\{([^}]+)\}/)?.[1];
  assert.ok(scroll);
  assert.match(scroll, /min-height: 0/);
  assert.match(scroll, /overflow: auto/);
  assert.match(scroll, /padding: 24px/);
  assert.match(scroll, /padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\)/);
});

test("Project inline rows and shared controls retain at least 44px coarse-pointer targets", () => {
  const parsed = ts.createSourceFile(
    "project.tsx",
    project,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const buttons = [];
  const knowledgeRows = [];
  const iconButtons = [];
  const memberRoleTriggers = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "button") {
      const text = node.getText(parsed);
      if (text.includes('className="kova-project-knowledge-row"')) knowledgeRows.push(text);
      else buttons.push(text);
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "Button") {
      const size = node.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "size",
      )?.initializer;
      if (size && ts.isStringLiteral(size) && size.text === "icon") iconButtons.push(node);
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "SelectTrigger") {
      const className = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "className",
      );
      if (className?.initializer && ts.isStringLiteral(className.initializer)) {
        const classes = className.initializer.text.split(/\s+/);
        if (classes.includes("w-28")) memberRoleTriggers.push(classes);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(buttons.length, 6);
  for (const button of buttons) assert.match(button, /min-h-11/);
  assert.equal(knowledgeRows.length, 2);
  for (const row of knowledgeRows) assert.match(row, /data-kova-button-shape="preserve"/);
  assert.ok(knowledgeRows.some((row) => row.includes('setTab("context")')));
  assert.ok(knowledgeRows.some((row) => row.includes('setTab("files")')));
  const detail = readFileSync("src/styles/project-detail.css", "utf8");
  const knowledge = detail.match(/\.kova-project-knowledge-row\s*\{([^}]+)\}/)?.[1];
  assert.match(knowledge, /min-height: 64px/);
  assert.match(knowledge, /border-radius: 0/);
  assert.ok(iconButtons.length > 0, "Inline icon actions use the shared semantic Button");
  const button = readFileSync("src/components/ui/button.tsx", "utf8");
  assert.match(button, /icon: "h-9 w-9 p-0 \[@media\(pointer:coarse\)\]:min-w-11"/);
  assert.match(button, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.equal(memberRoleTriggers.length, 1);
  assert.deepEqual(
    memberRoleTriggers[0],
    ["w-28"],
    "Role picker leaves height to the shared Select",
  );
  const select = readFileSync("src/components/ui/select.tsx", "utf8");
  assert.match(select, /flex h-9 w-full/);
  assert.match(select, /\[@media\(pointer:coarse\)\]:min-h-11/);
});
