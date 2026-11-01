import assert from "node:assert/strict";
import test from "node:test";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { observeTableOverflow } from "../../src/lib/table-overflow.ts";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  text,
} from "../helpers/ui-state-harness.mjs";

const IMAGE = "data:image/png;base64," + "A".repeat(1200);
const imageMarkdown = (src = IMAGE, alt = "Generated landscape") => `![${alt}](${src})`;

// Run the installed Markdown parser and real source renderers, then model the
// type/key boundary that React uses to retain image state. This is synthetic
// component evidence, not DOM, browser, or Radix focus-trap evidence.
function fixture(initial = {}) {
  let activeHooks;
  const contexts = [];
  const react = Object.fromEntries(
    ["useState", "useRef", "useEffect", "useId", "useCallback"].map((name) => [
      name,
      (...args) => activeHooks.react[name](...args),
    ]),
  );
  react.useMemo = (factory, deps) => {
    const ref = react.useRef(null);
    if (!ref.current || deps.some((value, index) => !Object.is(value, ref.current.deps[index])))
      ref.current = { value: factory(), deps };
    return ref.current.value;
  };
  react.createContext = (value) => {
    const context = { current: value, Provider: Symbol("Provider") };
    contexts.push(context);
    return context;
  };
  react.useContext = (context) => context.current;
  const icons = Object.fromEntries(
    ["Bookmark", "Download", "Maximize2", "Check", "Copy", "ExternalLink"].map((name) => [
      name,
      name,
    ]),
  );
  const image = loadUiModule(
    "src/components/ResponseImage.tsx",
    {
      react,
      "lucide-react": icons,
      "./ui/dialog": { Dialog: "dialog", DialogContent: "dialog-content", DialogTitle: "title" },
      "./ChatImage": { ChatImage: "chat-image" },
      "@/lib/chat-image-actions": { downloadChatImage: async () => {} },
    },
    { Error },
  );
  const markdown = loadUiModule("src/components/ResponseMarkdown.tsx", {
    react,
    "react-markdown": { __esModule: true, default: ReactMarkdown, defaultUrlTransform },
    "remark-gfm": { __esModule: true, default: remarkGfm },
    "./ResponseImage": image,
    "lucide-react": icons,
    "./response-output-blocks.css": {},
    "@/lib/table-overflow": { observeTableOverflow },
  });
  const markdownHooks = createHookHarness();
  let imageHooks;
  let previousIdentity;
  let parsed;
  let tree;
  let components;
  let mounts = 0;
  let opener;
  let focused;
  let props = { children: imageMarkdown(), onSaveImage: async () => {}, ...initial };
  function pathToImage(node, ancestors = []) {
    if (Array.isArray(node)) {
      for (const child of node) {
        const path = pathToImage(child, ancestors);
        if (path) return path;
      }
    } else if (node?.props) {
      const path = [...ancestors, node];
      if (node.type === components.img) return path;
      return pathToImage(node.props.children, path);
    }
  }
  function render(next = {}) {
    props = { ...props, ...next };
    activeHooks = markdownHooks;
    const output = markdownHooks.render(markdown.ResponseMarkdown, props);
    for (const context of contexts) {
      const provider = elements(output, (node) => node.type === context.Provider)[0];
      if (provider) context.current = provider.props.value;
    }
    const renderer = elements(output, (node) => node.type === ReactMarkdown)[0];
    components = renderer.props.components;
    parsed = ReactMarkdown(renderer.props);
    const path = pathToImage(parsed);
    if (!path) return;
    const imageNode = path.at(-1);
    const response = imageNode.type(imageNode.props);
    const identity = [...path, response].flatMap((node) => [node.type, node.key]);
    if (
      !previousIdentity ||
      previousIdentity.length !== identity.length ||
      identity.some((value, index) => value !== previousIdentity[index])
    ) {
      imageHooks?.unmount();
      if (opener) opener.isConnected = false;
      imageHooks = createHookHarness();
      mounts++;
      opener = {
        isConnected: true,
        focus(options) {
          assert.equal(options.preventScroll, true);
          focused = this;
        },
      };
    }
    previousIdentity = identity;
    activeHooks = imageHooks;
    tree = imageHooks.render(response.type, response.props);
    const ref = button("View full size").props.ref;
    if (ref) ref.current = opener;
  }
  const button = (name) =>
    elements(tree, (node) => node.type === "button" && text(node).trim() === name)[0];
  render();
  return {
    render,
    button,
    get tree() {
      return tree;
    },
    get parsed() {
      return parsed;
    },
    get components() {
      return components;
    },
    get mounts() {
      return mounts;
    },
    get opener() {
      return opener;
    },
    get focused() {
      return focused;
    },
    get dialog() {
      return elements(tree, (node) => node.type === "dialog")[0];
    },
    get error() {
      return text(elements(tree, (node) => node.props.role === "alert")[0]);
    },
  };
}

for (const wrap of [(value) => value, (value) => `> ${value}`, (value) => `Before\n\n${value}`]) {
  test(`same image preserves its viewer across callback and source refresh: ${wrap("image")}`, () => {
    const view = fixture({ children: wrap(imageMarkdown()) });
    const initialComponents = view.components;
    const opener = view.opener;
    view.button("View full size").props.onClick();
    view.render();
    assert.equal(view.dialog.props.open, true);
    for (let refresh = 0; refresh < 3; refresh++) {
      view.render({ sources: [], onSaveImage: async () => {}, onSourceClick: () => {} });
      assert.equal(view.dialog?.props.open, true);
      assert.equal(view.mounts, 1);
      assert.equal(view.opener, opener);
      for (const name of Object.keys(initialComponents))
        assert.equal(
          view.components[name],
          initialComponents[name],
          `${name} must retain its type`,
        );
    }
  });
}

test("disconnected Save error persists through rerenders and viewing; retry uses the newest callback", async () => {
  let oldCalls = 0;
  const calls = [];
  const view = fixture({
    onSaveImage: async () => {
      oldCalls++;
      throw new Error("Library is disconnected. Try again after reconnecting.");
    },
  });
  await view.button("Save to Library").props.onClick();
  view.render();
  const error = view.error;
  assert.match(error, /Library is disconnected/);
  view.render({ onSaveImage: async (...args) => calls.push(args), sources: [] });
  view.button("View full size").props.onClick();
  view.render({ onSourceClick: () => {} });
  assert.equal(view.error, error);
  assert.equal(view.dialog.props.open, true);
  view.dialog.props.onOpenChange(false);
  view.render();
  assert.equal(view.error, error);
  await view.button("Save to Library").props.onClick();
  view.render({ onSaveImage: async () => assert.fail("No automatic retry") });
  assert.equal(oldCalls, 1);
  assert.deepEqual(calls, [[IMAGE, "Generated landscape"]]);
  assert.equal(view.error, "");
  assert.equal(view.button("Saved to Library").props.disabled, true);
  assert.equal(view.mounts, 1);
});

test("in-flight Save survives same-image updates and cannot settle onto a replacement image", async () => {
  const pending = deferred();
  const view = fixture({ onSaveImage: () => pending.promise });
  const save = view.button("Save to Library").props.onClick();
  view.render({ onSaveImage: async () => {}, sources: [] });
  assert.equal(view.button("Saving…").props.disabled, true);
  view.button("View full size").props.onClick();
  view.render();
  view.render({ children: imageMarkdown("data:image/png;base64,Qg==", "New image") });
  assert.equal(view.mounts, 2);
  assert.equal(view.dialog, undefined);
  assert.equal(view.button("Save to Library").props.disabled, false);
  pending.resolve();
  await save;
  view.render();
  assert.equal(view.button("Save to Library").props.disabled, false);
  assert.equal(view.error, "");
});

test("replacing the image clears prior errors while changing its alt text does not", async () => {
  const view = fixture({
    onSaveImage: async () => {
      throw new Error("Disconnected");
    },
  });
  await view.button("Save to Library").props.onClick();
  view.render({ children: imageMarkdown(IMAGE, "Updated description") });
  assert.equal(view.error, "Disconnected");
  assert.equal(view.mounts, 1);
  view.render({ children: imageMarkdown("data:image/png;base64,Qg==") });
  assert.equal(view.error, "");
  assert.equal(view.mounts, 2);
});

test("explicit viewer close restores its exact connected View full size button", () => {
  const view = fixture();
  view.button("View full size").props.onClick();
  view.render({ onSaveImage: async () => {} });
  const close = elements(view.tree, (node) => node.type === "dialog-content")[0].props
    .onCloseAutoFocus;
  view.dialog.props.onOpenChange(false);
  view.render();
  let prevented = false;
  close({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(view.focused, view.opener);
  const detached = view.opener;
  detached.isConnected = false;
  detached.focus = () => assert.fail("Do not focus a detached image after navigation");
  close({ preventDefault() {} });
});

test("stable citation renderer reads the latest sources and source action", () => {
  const calls = [];
  const view = fixture({
    children: `${imageMarkdown()}\n\n[Source](https://example.test/source)`,
    sources: [{ id: "first", title: "First title", url: "https://example.test/source" }],
    onSourceClick: (id) => calls.push(`old:${id}`),
  });
  const renderer = view.components.a;
  view.render({
    sources: [{ id: "latest", title: "Latest title", url: "https://example.test/source" }],
    onSourceClick: (id, trigger) => calls.push([id, trigger]),
  });
  assert.equal(view.components.a, renderer);
  const link = elements(view.parsed, (node) => node.type === renderer)[0];
  const citation = link.type(link.props);
  assert.equal(citation.props["aria-label"], "View source: Latest title");
  const opener = { id: "exact-citation-button" };
  citation.props.onClick({ currentTarget: opener });
  assert.deepEqual(calls, [["latest", opener]]);
});

const proseBoxes = (view) =>
  elements(view.parsed, (node) => node.props.node?.data?.kovaTextOutput !== undefined);

test("a long image URL or data payload never becomes a second Text/Copy text output", () => {
  for (const src of [IMAGE, `https://example.test/${"a".repeat(1000)}.png`]) {
    const view = fixture({ children: imageMarkdown(src) });
    assert.equal(proseBoxes(view).length, 0);
    assert.equal(elements(view.parsed, (node) => node.type === view.components.img).length, 1);
  }
});

test("short prose plus a long inline image or link destination does not trigger long-prose boxing", () => {
  for (const children of [
    `Here is the image: ${imageMarkdown()}`,
    `Short [source](https://example.test/${"a".repeat(1000)}) text.`,
  ]) {
    const view = fixture({ children });
    assert.equal(proseBoxes(view).length, 0);
  }
});

test("true long visible prose keeps its exact Copy source without absorbing standalone images", () => {
  const prose = "A visible paragraph about the landscape. ".repeat(25).trim();
  for (const media of [imageMarkdown(), `[${imageMarkdown()}](https://example.test/image)`]) {
    const view = fixture({ children: `${prose}\n\n${media}\n\nA short caption.` });
    const boxes = proseBoxes(view);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].props.node.data.kovaTextOutput, prose);
    assert.equal(elements(boxes[0], (node) => node.type === view.components.img).length, 0);
  }
  assert.equal(proseBoxes(fixture({ children: prose, boxLongProse: false })).length, 0);
});
