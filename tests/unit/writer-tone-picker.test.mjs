import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as storagePolicy from "../../src/lib/principal-browser-storage.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  text,
} from "../helpers/ui-state-harness.mjs";

// Execute the actual Writer and picker callbacks with isolated hooks/services.
// This is state/contract coverage, not browser, Radix keyboard, or paint evidence.
const tones = [
  ["professional", "Professional"],
  ["casual", "Casual"],
  ["friendly", "Friendly"],
  ["confident", "Confident"],
  ["playful", "Playful"],
  ["academic", "Academic"],
  ["persuasive", "Persuasive"],
  ["concise", "Concise"],
];
const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));
const find = (tree, type) => elements(tree, (node) => node.type === type);
function fixture({ loaded = true } = {}) {
  const hooks = createHookHarness();
  const pickerHooks = createHookHarness();
  const auth = { isLoaded: loaded, isSignedIn: true, user: { id: "writer-a" } };
  const entries = new Map();
  const timers = new Map();
  const requests = [];
  const notices = [];
  const listeners = new Map();
  let timer = 0;
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const picker = loadUiModule("src/components/ui/searchable-picker.tsx", {
    react: pickerHooks.react,
    "lucide-react": primitives(["Check", "ChevronDown"]),
    "./command": primitives([
      "Command",
      "CommandEmpty",
      "CommandInput",
      "CommandItem",
      "CommandList",
    ]),
    "./popover": primitives(["Popover", "PopoverContent", "PopoverTrigger"]),
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  });
  const { Route } = loadUiModule(
    "src/routes/write.tsx",
    {
      react: {
        ...hooks.react,
        useMemo: (fn, deps) => hooks.react.useCallback(fn, deps)(),
      },
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@tanstack/react-start": { useServerFn: () => () => assert.fail("Unexpected Library write") },
      "lucide-react": primitives([
        "Bookmark",
        "Check",
        "Copy",
        "Download",
        "Eraser",
        "Loader2",
        "Sparkles",
        "Wand2",
      ]),
      sonner: {
        toast: Object.fromEntries(
          ["success", "error", "message"].map((kind) => [
            kind,
            (message) => notices.push([kind, message]),
          ]),
        ),
      },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/ui/searchable-picker": picker,
      "@/lib/auth-fetch": {
        authFetch(url, init) {
          const response = deferred();
          requests.push({ url, init, response });
          return response.promise;
        },
      },
      "@/lib/library.functions": { saveToLibrary: "saveToLibrary" },
      "@/components/auth/ClerkSafe": {
        useUser: () => auth,
        useClerkSafe: () => null,
      },
      "@/lib/principal-browser-storage.mjs": {
        ...storagePolicy,
        safeBrowserStorage: () => storage,
      },
    },
    {
      window: {
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: (name) => listeners.delete(name),
      },
      setTimeout(fn, delay) {
        const id = ++timer;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const render = () => hooks.render(Route.component);
  const control = () => find(render(), picker.SearchablePicker)[0];
  const popup = () => pickerHooks.render(picker.SearchablePicker, control().props);
  const list = () => {
    const child = find(popup(), picker.SearchablePickerList)[0];
    return picker.SearchablePickerList(child.props);
  };
  const button = (label) =>
    find(render(), "button").find((node) => text(node).replace(/\s+/g, " ").trim() === label);
  const field = (label) => elements(render(), (node) => node.props["aria-label"] === label)[0];
  const select = (value) =>
    find(list(), "CommandItem")
      .find((node) => node.props.value === `option:${value}`)
      .props.onSelect();
  render();
  render();
  return {
    auth,
    entries,
    requests,
    notices,
    render,
    control,
    popup,
    list,
    button,
    field,
    select,
    flushAutosave() {
      for (const [id, task] of timers) {
        if (task.delay === 400) {
          timers.delete(id);
          task.fn();
        }
      }
    },
    unmount: () => {
      hooks.unmount();
      pickerHooks.unmount();
    },
  };
}

function setDraft(f, content = "First sentence. Second sentence.") {
  f.field("Document title").props.onChange({ target: { value: "Current draft" } });
  f.field("Document content").props.onChange({ target: { value: content } });
  f.render();
}

test("Writer exposes all eight original tones through the actual searchable picker", () => {
  const f = fixture();
  assert.deepEqual(
    Array.from(f.control().props.options, (o) => [o.value, o.label]),
    tones,
  );
  assert.equal(f.control().props.value, "professional");
  assert.equal(f.popup().type, "Popover");
  assert.equal(find(f.popup(), "select").length, 0);
  assert.equal(find(f.popup(), "button")[0].props["aria-label"], "Tone");
  const list = f.list();
  assert.equal(find(list, "CommandInput")[0].props["aria-label"], "Search tones");
  assert.equal(find(list, "CommandInput")[0].props.autoFocus, true);
  assert.equal(text(find(list, "CommandEmpty")[0]), "No tones found.");
  for (const [value, label] of tones) {
    assert.equal(list.props.filter(`option:${value}`, `  ${label.toUpperCase()}  `, [label]), 1);
    assert.equal(list.props.filter(`option:${value}`, "missing tone", [label]), 0);
    f.select(value);
    assert.equal(f.control().props.value, value);
    assert.equal(text(find(f.popup(), "button")[0]).trim(), label);
    assert.equal(find(f.list(), "Check").length, 1);
  }
  assert.deepEqual(f.requests, []);
  f.unmount();
});

test("search, selection, close and reopen preserve the current draft, selection and autosave", () => {
  const f = fixture();
  setDraft(f);
  const editor = f.field("Document content");
  editor.props.ref.current = { selectionStart: 16, selectionEnd: 31 };
  editor.props.onSelect();
  f.popup().props.onOpenChange(true);
  assert.equal(f.popup().props.open, true);
  f.select("friendly");
  assert.equal(f.popup().props.open, false);
  f.popup().props.onOpenChange(true);
  f.popup().props.onOpenChange(false); // Radix dismissal leaves the committed value intact.
  assert.equal(f.control().props.value, "friendly");
  assert.equal(f.field("Document title").props.value, "Current draft");
  assert.equal(f.field("Document content").props.value, "First sentence. Second sentence.");
  f.flushAutosave();
  assert.equal(
    f.entries.get(storagePolicy.principalScopedStorageKey("kova-write-draft", "writer-a")),
    "First sentence. Second sentence.",
  );
  assert.equal(
    f.entries.get(storagePolicy.principalScopedStorageKey("kova-write-title", "writer-a")),
    "Current draft",
  );
  assert.deepEqual(f.requests, []);
  let prevented = false;
  find(f.popup(), "PopoverContent")[0].props.onCloseAutoFocus({
    preventDefault: () => (prevented = true),
  });
  assert.equal(prevented, false, "selection and dismissal keep normal trigger return focus");
  f.unmount();
});

test("Rewrite retains the selected substring and chosen tone, and Undo restores the draft", async () => {
  const f = fixture();
  setDraft(f);
  const editor = f.field("Document content");
  editor.props.ref.current = { selectionStart: 16, selectionEnd: 31 };
  editor.props.onSelect();
  f.select("concise");
  const pending = f.button("Rewrite").props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/write");
  assert.equal(f.requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(f.requests[0].init.body), {
    text: "Second sentence",
    action: "tone",
    tone: "concise",
  });
  assert.equal(f.button("Rewrite").props.disabled, true);
  await f.button("Rewrite").props.onClick();
  assert.equal(f.requests.length, 1, "pending guard still blocks repeated rewriting");
  f.requests[0].response.resolve({ ok: true, json: async () => ({ text: "Shorter" }) });
  await pending;
  assert.equal(f.field("Document content").props.value, "First sentence. Shorter.");
  assert.equal(f.control().props.value, "concise");
  f.button("Undo AI change").props.onClick();
  assert.equal(f.field("Document content").props.value, "First sentence. Second sentence.");
  assert.equal(f.field("Document title").props.value, "Current draft");
  f.unmount();
});

test("failed rewriting retains the draft and tone for an explicit retry", async () => {
  const f = fixture();
  setDraft(f);
  f.select("academic");
  const pending = f.button("Rewrite").props.onClick();
  f.requests[0].response.resolve({ ok: false, json: async () => ({ error: "unavailable" }) });
  await pending;
  assert.equal(f.field("Document content").props.value, "First sentence. Second sentence.");
  assert.equal(f.control().props.value, "academic");
  assert.equal(f.button("Rewrite").props.disabled, false);
  assert.deepEqual(f.notices, [["error", "AI request failed"]]);
  assert.equal(f.requests.length, 1);
  f.unmount();
});

test("unresolved auth disables the picker and Rewrite, and account changes retain stale-result guards", async () => {
  const f = fixture({ loaded: false });
  assert.equal(f.control().props.disabled, true);
  assert.equal(find(f.popup(), "button")[0].props.disabled, true);
  f.select("playful");
  await f.button("Rewrite").props.onClick();
  assert.equal(f.control().props.value, "professional");
  assert.deepEqual(f.requests, []);
  f.auth.isLoaded = true;
  f.render();
  setDraft(f);
  f.select("playful");
  const pending = f.button("Rewrite").props.onClick();
  f.auth.user = { id: "writer-b" };
  f.render();
  f.render();
  f.requests[0].response.resolve({ ok: true, json: async () => ({ text: "Old account result" }) });
  await pending;
  assert.equal(f.field("Document content").props.value, "");
  assert.equal(f.field("Document title").props.value, "Untitled document");
  assert.equal(f.control().props.value, "professional");
  assert.deepEqual(f.notices, []);
  assert.equal(
    f.entries.has(storagePolicy.principalScopedStorageKey("kova-write-draft", "writer-b")),
    false,
  );
  f.unmount();
});

test("tone and Rewrite reuse 44px targets, semantic tokens and the themed menu instead of a native popup", () => {
  const f = fixture();
  const picker = f.control();
  const rewrite = f.button("Rewrite");
  const group = elements(
    f.render(),
    (node) =>
      node.type === "div" &&
      find(node, "button").some((button) => text(button).trim() === "Rewrite") &&
      find(node, f.control().type).length === 1,
  ).at(-1);
  for (const node of [picker, rewrite, group]) {
    assert.match(node.props.className, /\bmin-h-11\b/);
    assert.match(node.props.className, /\brounded-md\b/);
    assert.doesNotMatch(node.props.className, /rounded-full/);
  }
  assert.match(picker.props.className, /\bmin-w-11\b/);
  assert.match(rewrite.props.className, /\bmin-w-11\b/);
  const styles = readFileSync("src/styles.css", "utf8");
  const spec = readFileSync("src/styles/spec400-system.css", "utf8");
  assert.match(styles, /--radius-md: var\(--kova-radius-input\)/);
  const geometry = readFileSync("src/styles/visual-tokens.css", "utf8");
  assert.match(geometry, /--kova-radius-input: 14px/);
  assert.match(geometry, /--kova-radius-compact: 10px/);
  assert.match(spec, /\.spec400-searchable-picker \[cmdk-input\] \{\s*min-height: 44px/);
  for (const file of ["popover", "command"]) {
    assert.match(
      readFileSync(`src/components/ui/${file}.tsx`, "utf8"),
      /bg-popover[\s\S]*text-popover-foreground/,
    );
  }
  f.unmount();
});

test("Writer footer version/export actions match ordinary control typography, padding and radius", () => {
  const labels = [
    "Save version",
    "Restore latest",
    "Download DOCX",
    "Download PDF",
    "Download XLSX",
    "Download PPTX",
    "Download HTML",
  ];
  for (const loaded of [false, true]) {
    const f = fixture({ loaded });
    const reference = f.button("Download .md").props.className.split(/\s+/);
    for (const label of labels) {
      const control = f.button(label);
      assert.ok(control, label);
      assert.equal(control.props.type, "button", label);
      assert.equal(control.props.disabled, !loaded, label);
      assert.equal(typeof control.props.onClick, "function", label);
      const classes = control.props.className.split(/\s+/);
      for (const token of [
        "min-h-11",
        "border",
        "border-border",
        "bg-background",
        "px-3",
        "py-1.5",
        "text-xs",
        "font-medium",
        "hover:bg-accent",
        "disabled:opacity-50",
      ]) {
        assert.ok(reference.includes(token), `reference ${token}`);
        assert.ok(classes.includes(token), `${label}: ${token}`);
      }
      assert.ok(classes.includes("rounded-md"), label);
      assert.ok(!classes.includes("underline"), label);
      assert.ok(!classes.includes("rounded-full"), label);
    }
    assert.deepEqual(f.requests, []);
    f.unmount();
  }
});
