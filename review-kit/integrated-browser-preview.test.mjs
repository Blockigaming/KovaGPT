import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { transitionBrowserPreview } from "./browser-takeover-fixture.mjs";

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
const jsx = (type, props) => ({ type, props: props ?? {} });
const source = (file) =>
  ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const sampleConversation = () => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Outputs review chat",
  messages: [
    {
      role: "assistant",
      activities: [
        {
          tool: "browser_interact",
          label: "Sample browser event · no live session",
          status: "done",
        },
      ],
    },
  ],
});

function fixture(conversation = sampleConversation()) {
  const state = [],
    effects = [],
    closed = [];
  let cursor = 0,
    tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      state[index] ??= { value: initial };
      return [
        state[index].value,
        (value) => {
          state[index].value = typeof value === "function" ? value(state[index].value) : value;
        },
      ];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!state[index] || deps.some((value, i) => value !== state[index].deps[i])) {
        state[index] = { deps };
        effects.push(effect);
      }
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": {
      ArrowUpRight: "svg",
      Globe2: "svg",
      Pause: "svg",
      Play: "svg",
      Hand: "svg",
      Square: "svg",
    },
    "../src/components/ui/dialog": {
      Dialog: "Dialog",
      DialogContent: "DialogContent",
      DialogTitle: "DialogTitle",
      DialogDescription: "DialogDescription",
    },
    "./integrated-browser-preview.css": {},
    "../src/components/ConversationHeaderActions": {
      ConversationHeaderActions: "ActualConversationHeader",
    },
    "./browser-takeover-fixture.mjs": { transitionBrowserPreview },
  };
  const load = (file) => {
    const exports = {};
    vm.runInNewContext(source(file), {
      exports,
      require(name) {
        assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
        return modules[name];
      },
      fetch() {
        throw Error("Synthetic preview must not make network requests");
      },
      localStorage: {
        setItem() {
          throw Error("Synthetic input must remain ephemeral");
        },
      },
    });
    return exports;
  };
  const preview = load("review-kit/IntegratedBrowserPreview.tsx");
  modules["./IntegratedBrowserPreview"] = preview;
  const wrapper = load("review-kit/IntegratedConversationHeader.tsx");
  const props = { conversation, signedIn: true, userTier: "plus", onShare() {} };
  const render = () => {
    cursor = 0;
    tree = wrapper.ConversationHeaderActions(props);
    return tree;
  };
  const flush = () => {
    render();
    for (const effect of effects.splice(0)) effect();
    render();
  };
  const focus = () => {};
  const dialog = () => {
    const element = tree.props.browserPresentation.renderDialog({
      activity: { id: "sample" },
      onClose: () => closed.push(true),
      onCloseAutoFocus: focus,
    });
    return element.type(element.props);
  };
  const button = (label) => {
    const found = nodes(dialog()).find(
      (node) => node.type === "button" && text(node).trim() === label,
    );
    assert.ok(found, `Missing button ${label}`);
    return found;
  };
  const click = (label) => {
    button(label).props.onClick();
    flush();
  };
  flush();
  return {
    props,
    render,
    flush,
    preview,
    dialog,
    button,
    click,
    closed,
    focus,
    get tree() {
      return tree;
    },
  };
}

test("private wrapper renders the actual header and passes sample presentation only to the exact fixture chat", () => {
  const f = fixture();
  assert.equal(f.tree.type, "ActualConversationHeader");
  assert.equal(f.tree.props.conversation, f.props.conversation);
  assert.equal(f.tree.props.onShare, f.props.onShare);
  assert.ok(f.tree.props.browserPresentation);
  for (const conversation of [
    { ...sampleConversation(), id: "ordinary-chat" },
    { ...sampleConversation(), messages: [] },
    {
      ...sampleConversation(),
      messages: [{ activities: [{ tool: "browser_interact", label: "Real browser" }] }],
    },
  ])
    assert.equal(fixture(conversation).tree.props.browserPresentation, undefined);
});

test("integrated sample requires pause, separates release from resume, and never makes a request", () => {
  const f = fixture();
  assert.match(text(f.dialog()), /Sample automation is active/);
  assert.equal(
    nodes(f.dialog()).some((node) => node.type === "button" && text(node).trim() === "Take over"),
    false,
  );
  f.click("Pause to take over");
  assert.match(text(f.dialog()), /No action is in flight/);
  f.click("Take over");
  assert.match(text(f.dialog()), /You have control. Automation is paused/);
  const input = nodes(f.dialog()).find((node) => node.type === "input");
  input.props.onChange({ target: { value: "temporary sample text" } });
  f.flush();
  assert.equal(
    nodes(f.dialog()).find((node) => node.type === "input").props.value,
    "temporary sample text",
  );
  f.click("Return control");
  assert.match(text(f.dialog()), /Automation paused/);
  assert.equal(
    nodes(f.dialog()).some((node) => node.type === "input"),
    false,
  );
  f.click("Take over");
  assert.equal(nodes(f.dialog()).find((node) => node.type === "input").props.value, "");
  f.click("Return control");
  f.click("Resume automation");
  assert.match(text(f.dialog()), /Sample automation is active/);
  f.click("End session");
  assert.match(text(f.dialog()), /Session ended/);
  assert.equal(
    nodes(f.dialog()).some((node) => node.type === "button"),
    false,
  );
});

test("dialog dismissal clears sample entry without implicitly resuming and preserves the real header focus callback", () => {
  const f = fixture();
  f.click("Pause to take over");
  f.click("Take over");
  nodes(f.dialog())
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "discard me" } });
  f.flush();
  const dialog = f.dialog();
  assert.equal(
    nodes(dialog).find((node) => node.type === "DialogContent").props.onCloseAutoFocus,
    f.focus,
  );
  dialog.props.onOpenChange(false);
  f.flush();
  assert.equal(f.closed.length, 1);
  assert.match(text(f.dialog()), /You have control. Automation is paused/);
  assert.equal(nodes(f.dialog()).find((node) => node.type === "input").props.value, "");
  f.props.conversation = { ...f.props.conversation, id: "next-chat" };
  f.flush();
  f.props.conversation = sampleConversation();
  f.flush();
  assert.match(text(f.dialog()), /Sample automation is active/);
});

test("thumbnail is one self-contained sample page without a remote image, link, iframe, or duplicate browser chrome", () => {
  const f = fixture();
  const page = f.preview.SampleBrowserThumbnail();
  assert.match(text(page), /fieldnotes/);
  assert.match(text(page), /fieldnotes.example.invalidSample/);
  assert.equal(
    nodes(page).filter((node) => node.props.className === "review-browser-page").length,
    1,
  );
  assert.ok(
    nodes(page).every((node) => !["img", "a", "iframe", "canvas", "button"].includes(node.type)),
  );
  assert.ok(
    nodes(page).every(
      (node) => !node.props.src && !node.props.href && !node.props.dangerouslySetInnerHTML,
    ),
  );
});

test("production config does not import the sample wrapper and private build requires explicit Node-only opt-in", () => {
  const normal = readFileSync("vite.config.ts", "utf8");
  assert.doesNotMatch(
    normal,
    /IntegratedConversationHeader|vite-integrated-review|PRIVATE_INTEGRATED_REVIEW/,
  );
  const config = readFileSync("review-kit/vite-integrated-review.config.ts", "utf8");
  assert.match(config, /KOVA_PRIVATE_INTEGRATED_REVIEW !== "1"/);
  assert.match(config, /KOVA_BROWSER_PREVIEW !== "node"/);
  assert.match(config, /find: \/\^@\\\/components\\\/ConversationHeaderActions\$\//);
  assert.match(
    readFileSync("review-kit/IntegratedConversationHeader.tsx", "utf8"),
    /from "\.\.\/src\/components\/ConversationHeaderActions"/,
  );
});

test("Vite resolves the private wrapper once while the normal config retains the real header", async () => {
  const { resolveConfig } = await import("vite");
  const { resolve } = await import("node:path");
  const originalReview = process.env.KOVA_PRIVATE_INTEGRATED_REVIEW;
  const originalPreview = process.env.KOVA_BROWSER_PREVIEW;
  process.env.KOVA_PRIVATE_INTEGRATED_REVIEW = "1";
  process.env.KOVA_BROWSER_PREVIEW = "node";
  try {
    const privateConfig = await resolveConfig(
      { configFile: "review-kit/vite-integrated-review.config.ts" },
      "build",
    );
    const privateResolve = privateConfig.createResolver();
    const wrapper = await privateResolve(
      "@/components/ConversationHeaderActions",
      resolve("src/routes/index.tsx"),
    );
    assert.equal(wrapper, resolve("review-kit/IntegratedConversationHeader.tsx"));
    assert.equal(
      await privateResolve("../src/components/ConversationHeaderActions", wrapper),
      resolve("src/components/ConversationHeaderActions.tsx"),
    );
    const normalConfig = await resolveConfig({ configFile: "vite.config.ts" }, "build");
    assert.ok(
      normalConfig.resolve.alias.every(
        (entry) => !entry.replacement.includes("IntegratedConversationHeader"),
      ),
    );
    assert.equal(
      await normalConfig.createResolver()(
        "../components/ConversationHeaderActions",
        resolve("src/routes/index.tsx"),
      ),
      resolve("src/components/ConversationHeaderActions.tsx"),
    );
  } finally {
    if (originalReview === undefined) delete process.env.KOVA_PRIVATE_INTEGRATED_REVIEW;
    else process.env.KOVA_PRIVATE_INTEGRATED_REVIEW = originalReview;
    if (originalPreview === undefined) delete process.env.KOVA_BROWSER_PREVIEW;
    else process.env.KOVA_BROWSER_PREVIEW = originalPreview;
  }
});

test("sample browser viewport remains landscape and cannot shrink its caption", () => {
  const css = readFileSync("review-kit/integrated-browser-preview.css", "utf8");
  assert.match(css, /aspect-ratio: 16 \/ 10/);
  assert.match(css, /\.review-browser-page\s*\{\s*flex: 0 0 auto;/);
});
