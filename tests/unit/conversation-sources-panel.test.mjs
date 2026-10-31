import * as browserActivity from "../../src/lib/browser-activity-contract.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
let inventory = { web: [], memory: [], attachments: [], browser: [] };
const jsx = (type, props) => ({ type, props: props ?? {} });
const modules = {
  "@/lib/browser-activity-contract.mjs": browserActivity,
  "@/assets/plugins/github.svg": { default: "github.svg" },
  react: { useMemo: (fn) => fn(), useState: (value) => [value, () => {}] },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "lucide-react": Object.fromEntries(
    [
      "BookOpen",
      "ChevronRight",
      "File",
      "Globe",
      "Image",
      "Monitor",
      "GitBranch",
      "Database",
      "Zap",
      "LibraryBig",
      "CloudSun",
    ].map((k) => [k, k]),
  ),
  "@/components/auth/ClerkSafe": {
    useUser: () => ({ user: { id: "owner" }, isLoaded: true, isSignedIn: true }),
  },
  "@/components/MemorySourcesDialog": { MemorySourcesDialog: "MemorySourcesDialog" },
  "@/lib/conversation-sources": {
    conversationSources: (_chat, owner) => {
      assert.equal(owner, "owner");
      return inventory;
    },
  },
};
const code = ts.transpileModule(
  readFileSync("src/components/ConversationSourcesView.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
new Function("exports", "require", code)(exports, (name) => {
  assert.ok(name in modules, name);
  return modules[name];
});
const render = (onOpenAttachment = () => {}) =>
  exports.ConversationSourcesView({ inventory, onOpenAttachment, onOpenMemory: () => {} });
const nodes = (value) =>
  !value || typeof value !== "object"
    ? []
    : Array.isArray(value)
      ? value.flatMap(nodes)
      : [value, ...nodes(value.props?.children)];
const text = (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : Array.isArray(value)
      ? value.map(text).join(" ")
      : value?.props
        ? text(value.props.children)
        : "";
test("empty provenance produces no Sources section", () => {
  inventory = { web: [], memory: [], attachments: [], browser: [] };
  assert.equal(render(), null);
});
test("web sources expand as safe links and browser status is explicit", () => {
  inventory = {
    web: [
      {
        id: "web",
        source: { title: "Recorded source", url: "https://example.com/", domain: "example.com" },
      },
    ],
    memory: [],
    attachments: [],
    browser: [{ id: "event", label: "Recorded browser operation", status: "active" }],
  };
  const view = render();
  assert.match(text(view), /Sources.*Web search.*Cloud browser.*Recorded/);
  const link = nodes(view).find((n) => n.type === "a");
  assert.equal(link.props.href, "https://example.com/");
  assert.equal(link.props.rel, "noopener noreferrer");
  assert.ok(nodes(view).some((n) => n.type === "details"));
});
test("attachments say available and open their existing output preview", () => {
  inventory = {
    web: [],
    memory: [],
    browser: [],
    attachments: [
      { id: "file", name: "notes.md", attachmentKind: "text_file", outputId: "m:attachment:0" },
    ],
  };
  let opened;
  const view = render((id) => (opened = id));
  assert.match(text(view), /Available.*Use in a response is not confirmed/);
  nodes(view)
    .find((n) => n.type === "button")
    .props.onClick();
  assert.equal(opened, "m:attachment:0");
});
test("memory context is labeled provided rather than evidence of influence", () => {
  inventory = {
    web: [],
    attachments: [],
    browser: [],
    memory: [{ id: "memory", name: "Chat memory", sources: { ownerId: "owner", sources: [] } }],
  };
  assert.match(text(render()), /Memory.*does not prove it influenced/);
});

test("browser activity review uses pure view without runtime or network access", () => {
  const fixture = readFileSync("review-kit/sources-preview.tsx", "utf8");
  assert.match(fixture, /Synthetic state only/);
  assert.match(fixture, /ConversationSourcesView/);
  assert.doesNotMatch(fixture, /fetch\s*\(|WebSocket|authFetch|localStorage|providerKey|apiKey/);
  const view = readFileSync("src/components/ConversationSourcesView.tsx", "utf8");
  assert.doesNotMatch(view, /useUser|fetch\s*\(|authFetch|localStorage/);
});

test("browser-only activity has its own section without an empty Sources heading", () => {
  inventory = {
    web: [],
    memory: [],
    attachments: [],
    browser: [{ id: "event", label: "Recorded browser operation", status: "active" }],
  };
  const view = render();
  const headings = nodes(view)
    .filter((n) => n.type === "h2")
    .map(text);
  assert.deepEqual(headings, ["Cloud browser"]);
  assert.ok(
    nodes(view).some(
      (n) => n.type === "button" && n.props["aria-label"] === "Open browser activity",
    ),
  );
});

test("Activity shows the latest fresh session and excludes stale tab counts", () => {
  const inventory = {
    browser: [
      { status: "active", browser: { sessionId: "fixture", tabCount: 5, observedAt: Date.now() } },
    ],
  };
  assert.match(
    text(exports.ConversationActivitySummary({ inventory })),
    /Activity.*Browser.*5.*tabs/,
  );
  inventory.browser[0].browser.observedAt -= 600000;
  assert.equal(exports.ConversationActivitySummary({ inventory }), null);
});
