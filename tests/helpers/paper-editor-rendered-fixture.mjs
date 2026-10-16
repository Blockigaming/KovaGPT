import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ts from "typescript";
import { parseDocument } from "htmlparser2";
import { compile } from "@tailwindcss/node";
import postcss from "postcss";
import { reactFixture } from "./kova-react-fixture.mjs";

const require = createRequire(import.meta.url);
const noop = () => {};

// Execute production presentation modules. Account/storage/router boundaries are
// deterministic fixtures; no services, browser, network, or effects run here.
export function loadPresentation(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        if (["react", "react/jsx-runtime", "lucide-react"].includes(id)) return require(id);
        throw new Error(`Unexpected presentation dependency: ${id}`);
      },
    },
  );
  return module.exports;
}

export const { DocumentPaper } = loadPresentation("src/components/DocumentPaper.tsx", {
  "react-markdown": Markdown,
  "remark-gfm": remarkGfm,
});

// Radix portals intentionally do not SSR. Replace only the portal primitives so
// the production dialog's children/class/ARIA structure can be inspected too.
const fragment = ({ children }) => React.createElement(React.Fragment, null, children);
const dialogPrimitive =
  (tag) =>
  ({ children, className, ...props }) =>
    React.createElement(
      tag,
      {
        className,
        ...Object.fromEntries(
          Object.entries(props).filter(([key]) => key.startsWith("aria-") || key === "tabIndex"),
        ),
      },
      children,
    );
const surface = loadPresentation("src/components/ArtifactEditorSurface.tsx", {
  "@/lib/dialog-return-focus": { restoreDialogFocus: noop },
  "@radix-ui/react-dialog": {
    Root: fragment,
    Portal: fragment,
    Overlay: dialogPrimitive("div"),
    Content: dialogPrimitive("section"),
    Title: dialogPrimitive("h2"),
  },
});

function toReact(node, key) {
  if (Array.isArray(node)) return node.map((child, index) => toReact(child, index));
  if (node == null || typeof node !== "object") return node;
  const { children, ...props } = node.props;
  return React.createElement(
    node.type ?? React.Fragment,
    { ...props, key: node.key ?? key },
    ...[children].flat().map((child, index) => toReact(child, index)),
  );
}

export function editorFixture({
  content,
  paper = false,
  presentation = "page",
  outline = false,
} = {}) {
  const focusReturns = [];
  const title = "Synthetic document review";
  const fixture = reactFixture(
    "src/components/ArtifactEditor.tsx",
    (exports) => () =>
      exports.ArtifactEditorSession({
        open: true,
        onClose: noop,
        kind: "writing",
        initialContent: content,
        chatId: "fixture-chat",
        messageId: "fixture-message",
        documentId: "fixture-document",
        presentation,
      }),
    {
      sourceSuffix: "\nexport { ArtifactEditorSession };",
      globals: { window: { location: { href: "http://fixture.invalid/document" } } },
      modules: {
        "lucide-react": require("lucide-react"),
        "./ArtifactHistoryPanel": { ArtifactHistoryPanel: fragment },
        "@/lib/artifact-history-status": loadPresentation("src/lib/artifact-history-status.ts"),
        "@/lib/dialog-return-focus": {
          restoreDialogFocus: (target, url) => focusReturns.push({ target, url }),
        },
        "./ArtifactEditorSurface": surface,
        "./DocumentPaper": { DocumentPaper },
        "@/lib/print-document": { printDocumentPaper: noop },
        "@/lib/use-device-record": {
          useDeviceRecord: () => ({
            value: { title },
            loaded: true,
            stored: true,
            dirty: false,
            error: "",
            setValue: noop,
          }),
        },
        "./DeviceRecoveryStatus": loadPresentation("src/components/DeviceRecoveryStatus.tsx"),
        "@/lib/document-formatting.mjs": {
          EMPTY_DOCUMENT_TITLE: { title: "" },
          isDocumentTitle: () => true,
          formatDocumentSelection: noop,
        },
        "@/lib/writing-export/common": { safeDocumentFilename: noop, OFFICE_EXPORT_NOTES: {} },
        "@tanstack/react-router": { Link: "a", useBlocker: noop },
        "@tanstack/react-start": { useServerFn: () => noop },
        "@/lib/library.functions": { saveToLibrary: noop },
        "@/components/auth/ClerkSafe": {
          useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "fixture-user" } }),
          useClerkSafe: () => null,
        },
        "@/lib/workspace-handoffs": {},
        "@/components/CollaborationStatus": loadPresentation(
          "src/components/CollaborationStatus.tsx",
        ),
        "@/components/CanvasComments": { CanvasComments: () => null },
        "@/lib/use-canvas-collaboration": {
          useCanvasCollaboration: () => ({
            ready: false,
            presence: { status: "reconnecting", peers: 0 },
            snapshot: { document: { title, content }, canEdit: true },
          }),
        },
        "./artifact-utils": {},
        "@/lib/serialized-write-queue": { createSerializedWriteQueue: () => ({}) },
        "@/lib/canvas-autosave-policy.mjs": {},
      },
    },
  );
  fixture.render();
  if (paper) {
    fixture.find("button", (node) => node.props.children === "Paper view").props.onClick();
    fixture.render();
  }
  if (outline) {
    fixture
      .find("button", (node) => node.props["aria-label"] === "Toggle document outline")
      .props.onClick();
    fixture.render();
  }
  // Run real React server rendering, then parse the resulting HTML tree.
  const renderDocument = () => {
    const html = renderToStaticMarkup(toReact(fixture.tree));
    return { html, document: parseDocument(html) };
  };
  return { ...renderDocument(), fixture, renderDocument, focusReturns };
}

export function elements(node, predicate = () => true) {
  return [
    ...(node.type === "tag" && predicate(node) ? [node] : []),
    ...(node.children ?? []).flatMap((child) => elements(child, predicate)),
  ];
}

export const classes = (node) => (node.attribs?.class ?? "").split(/\s+/).filter(Boolean);
export const text = (node) =>
  node.type === "text" ? node.data : (node.children ?? []).map(text).join("");

export async function generatedCss(documents) {
  const tokens = new Set(documents.flatMap((doc) => elements(doc).flatMap(classes)));
  const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
    base: `${process.cwd()}/src`,
    onDependency: noop,
  });
  const root = postcss.parse(compiler.build([...tokens]));
  return {
    declaration(token, property, suffix = "") {
      assert.ok(tokens.has(token), `The rendered DOM must use ${token}`);
      const selector = `.${token.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}${suffix}`;
      let found;
      root.walkRules((rule) => {
        if (rule.selector === selector)
          rule.walkDecls(property, (declaration) => {
            const media = [];
            for (let parent = rule.parent; parent; parent = parent.parent)
              if (parent.type === "atrule" && parent.name === "media") media.push(parent.params);
            found = { value: declaration.value, important: Boolean(declaration.important), media };
          });
      });
      assert.ok(found, `Missing generated declaration: ${selector} { ${property} }`);
      return found;
    },
  };
}
