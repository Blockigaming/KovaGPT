import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const sourcePath = "src/components/translation/TranslationWorkspace.tsx";
const source = readFileSync(sourcePath, "utf8");
const catalog = loadUiModule("src/lib/translation-catalog.ts", {});
const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));
const pair = catalog.getTranslationPair("english-to-french");
const exactDraft = "  Keep this source\nwith punctuation — and spacing. \t";

// Executes the actual consumer and shared picker with isolated hooks/services.
// This is state/filtering evidence, not native popover placement or keyboard QA.
function fixture(initialPair = pair) {
  const hooks = createHookHarness();
  const pickerHooks = new Map(
    ["Source language", "Target language"].map((label) => [label, createHookHarness()]),
  );
  let activePickerHooks = pickerHooks.get("Source language");
  const requests = [],
    copies = [];
  const pickerModule = loadUiModule("src/components/ui/searchable-picker.tsx", {
    react: new Proxy({}, { get: (_target, key) => activePickerHooks.react[key] }),
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
  const { TranslationWorkspace } = loadUiModule(
    sourcePath,
    {
      react: hooks.react,
      "lucide-react": primitives([
        "ArrowLeftRight",
        "Check",
        "Copy",
        "Loader2",
        "Paperclip",
        "Sparkles",
      ]),
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/components/ui/searchable-picker": pickerModule,
      "@/lib/translation-catalog": catalog,
      "@/lib/auth-fetch": {
        fetchWithTimeoutAuthenticated(url, init, timeout) {
          const pending = deferred();
          requests.push({ ...pending, url, init, timeout });
          return pending.promise;
        },
      },
    },
    {
      TextEncoder,
      navigator: { clipboard: { writeText: async (value) => copies.push(value) } },
      window: { setTimeout() {} },
    },
  );
  const render = () => hooks.render(TranslationWorkspace, { pair: initialPair });
  const field = (id) => elements(render(), (node) => node.props.id === id)[0];
  const button = (label) =>
    elements(
      render(),
      (node) =>
        node.type === "button" &&
        (node.props["aria-label"] === label || text(node).trim() === label),
    )[0];
  const picker = (label) => {
    const wrapper = elements(
      render(),
      (node) => typeof node.type === "function" && node.props.label === label,
    )[0];
    assert.ok(wrapper);
    return elements(
      wrapper.type(wrapper.props),
      (node) => node.type === pickerModule.SearchablePicker,
    )[0];
  };
  const pickerTree = (label) => {
    activePickerHooks = pickerHooks.get(label);
    return activePickerHooks.render(pickerModule.SearchablePicker, picker(label).props);
  };
  const command = (label) => {
    const list = elements(
      pickerTree(label),
      (node) => node.type === pickerModule.SearchablePickerList,
    )[0];
    return pickerModule.SearchablePickerList(list.props);
  };
  render();
  return {
    render,
    picker,
    pickerTree,
    command,
    button,
    requests,
    copies,
    heading: () => text(elements(render(), (node) => node.type === "h1")[0]),
    source: () => field("translation-source").props.value,
    output: () => field("translation-output").props.value,
    type(value) {
      field("translation-source").props.onChange({ target: { value } });
    },
    choose(label, value) {
      const option = elements(
        command(label),
        (node) => node.type === "CommandItem" && node.props.value === `option:${value}`,
      )[0];
      assert.ok(option, `${label}: ${value}`);
      option.props.onSelect();
    },
    swap() {
      button("Swap source and target languages").props.onClick();
    },
    translate() {
      button("Translate").props.onClick();
    },
    async respond(value = "  Traduction exacte.\n", status = 200) {
      requests.at(-1).resolve({
        ok: status === 200,
        status,
        json: async () => (status === 200 ? { text: value } : { error: "Rejected" }),
      });
      await settle();
    },
  };
}

test("both full language catalogs use the actual searchable picker with distinct labels and source-only Detect", () => {
  const f = fixture();
  assert.ok(catalog.TRANSLATION_LANGUAGES.length > 7);
  for (const label of ["Source language", "Target language"]) {
    const selected = f.picker(label);
    assert.equal(selected.props["aria-label"], label);
    assert.equal(selected.props.searchLabel, `Search ${label.toLowerCase()}s`);
    assert.equal(f.pickerTree(label).type, "Popover");
    assert.equal(elements(f.pickerTree(label), (node) => node.type === "select").length, 0);
    const options = selected.props.options;
    const realOptions = options.filter((option) => option.value !== "Detect language");
    assert.deepEqual(
      Array.from(realOptions, (option) => option.value),
      Array.from(catalog.TRANSLATION_LANGUAGES),
    );
    assert.equal(
      options.some((option) => option.value === "Detect language"),
      label === "Source language",
    );
    const command = f.command(label);
    const choices = elements(command, (node) => node.type === "CommandItem");
    const french = choices.find((node) => node.props.value === "option:French");
    assert.equal(command.props.filter(french.props.value, "  FRENCH ", french.props.keywords), 1);
    assert.equal(
      command.props.filter(french.props.value, "missing-language", french.props.keywords),
      0,
    );
    assert.equal(
      text(elements(command, (node) => node.type === "CommandEmpty")[0]),
      "No languages found.",
    );
    assert.equal(
      elements(command, (node) => node.type === "CommandInput")[0].props["aria-label"],
      selected.props.searchLabel,
    );
  }
});

test("language selection and repeated Swap update the visible sentence-case heading without sending or losing the draft", () => {
  const f = fixture();
  assert.equal(f.heading(), "Translate English to French with Kova");
  f.type(exactDraft);
  f.swap();
  assert.equal(f.heading(), "Translate French to English with Kova");
  assert.equal(f.source(), exactDraft);
  f.swap();
  assert.equal(f.heading(), "Translate English to French with Kova");
  f.choose("Source language", "Japanese");
  f.choose("Target language", "Portuguese (Brazil)");
  assert.equal(f.heading(), "Translate Japanese to Portuguese (Brazil) with Kova");
  assert.equal(f.source(), exactDraft);
  assert.equal(f.output(), "");
  assert.equal(f.requests.length, 0);
});

test("Detect language remains a real source option, blocks Swap, and produces a current target heading", () => {
  const f = fixture(null);
  f.type(exactDraft);
  assert.equal(f.heading(), "Translate to Spanish with Kova");
  assert.equal(f.button("Swap source and target languages").props.disabled, true);
  f.swap();
  assert.equal(f.source(), exactDraft);
  f.choose("Target language", "Hindi");
  assert.equal(f.heading(), "Translate to Hindi with Kova");
  f.choose("Source language", "French");
  assert.equal(f.button("Swap source and target languages").props.disabled, false);
  f.choose("Source language", "Detect language");
  assert.equal(f.heading(), "Translate to Hindi with Kova");
  assert.equal(f.button("Swap source and target languages").props.disabled, true);
  assert.equal(f.source(), exactDraft);
  assert.equal(f.requests.length, 0);
});

test("closing a language picker retains its selection, exact draft and normal focus restoration", () => {
  const f = fixture();
  f.type(exactDraft);
  f.pickerTree("Target language").props.onOpenChange(true);
  assert.equal(f.pickerTree("Target language").props.open, true);
  f.pickerTree("Target language").props.onOpenChange(false);
  assert.equal(f.pickerTree("Target language").props.open, false);
  let prevented = false;
  elements(
    f.pickerTree("Target language"),
    (node) => node.type === "PopoverContent",
  )[0].props.onCloseAutoFocus({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(f.picker("Target language").props.value, "French");
  assert.equal(f.source(), exactDraft);
  assert.equal(f.requests.length, 0);
});

test("completed translation and source exchange exactly on Swap and the canonical route metadata stays independent", async () => {
  const f = fixture();
  f.type(exactDraft);
  f.translate();
  assert.equal(f.requests[0].url, "/api/write");
  assert.equal(f.requests[0].timeout, 130_000);
  const request = JSON.parse(f.requests[0].init.body);
  assert.equal(request.text, exactDraft);
  assert.equal(request.action, "custom");
  assert.match(request.instructions, /from English to French/);
  const result = "  Traduction exacte.\n";
  await f.respond(result);
  f.swap();
  assert.equal(f.source(), result);
  assert.equal(f.output(), exactDraft);
  assert.equal(f.heading(), "Translate French to English with Kova");
  f.swap();
  assert.equal(f.source(), exactDraft);
  assert.equal(f.output(), result);
  assert.equal(f.heading(), "Translate English to French with Kova");
  assert.equal(f.requests.length, 1);
  const route = readFileSync("src/routes/translate.$pairSlug.tsx", "utf8");
  assert.match(route, /loaderData\.pair\.source.*loaderData\.pair\.target/);
  assert.match(route, /rel: "canonical"/);
});

for (const change of ["source language", "target language", "swap", "source draft"]) {
  test(`${change} preserves revision invalidation and ignores an older translation response`, async () => {
    const f = fixture();
    f.type(exactDraft);
    f.translate();
    if (change === "source language") f.choose("Source language", "Tamil");
    if (change === "target language") f.choose("Target language", "Hindi");
    if (change === "swap") f.swap();
    if (change === "source draft") f.type("newer exact draft\n ");
    await f.respond("Old response that must be ignored");
    assert.equal(f.output(), "");
    assert.equal(f.source(), change === "source draft" ? "newer exact draft\n " : exactDraft);
    assert.equal(f.requests.length, 1);
    assert.equal(f.button("Translate").props.disabled, false);
  });
}

test("choosing a language clears stale output but retains input, while a rejected request also preserves exact input", async () => {
  const f = fixture();
  f.type(exactDraft);
  f.translate();
  await f.respond();
  f.choose("Target language", "Urdu");
  assert.equal(f.output(), "");
  assert.equal(f.source(), exactDraft);
  assert.equal(f.requests.length, 1);
  f.translate();
  await f.respond("", 429);
  assert.equal(f.source(), exactDraft);
  assert.match(
    text(elements(f.render(), (node) => node.props.role === "alert")[0]),
    /Your text is still here/,
  );
});

test("the actual workspace uses specified heading, surface, control and icon geometry", async () => {
  const f = fixture();
  const heading = elements(f.render(), (node) => node.type === "h1")[0];
  for (const token of [
    "text-2xl",
    "leading-8",
    "tracking-normal",
    "sm:text-[28px]",
    "sm:leading-9",
  ])
    assert.ok(heading.props.className.split(" ").includes(token));
  const surface = elements(
    f.render(),
    (node) => node.type === "div" && node.props.className?.includes("md:grid-cols-2"),
  )[0];
  assert.match(surface.props.className, /\brounded-xl\b/);
  const theme = readFileSync("src/styles.css", "utf8");
  const tokens = readFileSync("src/styles/visual-tokens.css", "utf8");
  const structural = readFileSync("src/styles/spec400-system.css", "utf8");
  assert.match(theme, /--radius-lg: var\(--kova-radius-control\)/);
  assert.match(theme, /--radius-xl: var\(--kova-radius-card\)/);
  assert.match(tokens, /:root\s*\{[^}]*--kova-radius-control: 14px;/s);
  assert.match(tokens, /:root\s*\{[^}]*--kova-radius-card: 20px;/s);
  assert.doesNotMatch(structural, /:root:root|--(?:radius|kova-radius-[a-z-]+)\s*:/);
  for (const control of elements(f.render(), (node) => node.type === "button")) {
    assert.match(control.props.className, /\brounded-lg\b/);
    assert.match(control.props.className, /\b(?:min-h-11|h-11|min-h-20)\b/);
  }
  for (const label of ["Source language", "Target language"]) {
    assert.match(f.picker(label).props.className, /\bmin-h-11\b.*\brounded-lg\b/);
    assert.ok(f.picker(label).props.className.includes("[&>svg]:h-5 [&>svg]:w-5"));
  }
  for (const icon of elements(f.render(), (node) =>
    ["ArrowLeftRight", "Copy", "Paperclip", "Sparkles"].includes(node.type),
  ))
    assert.equal(icon.props.className, "h-5 w-5");
  f.type(exactDraft);
  f.translate();
  assert.equal(
    elements(f.render(), (node) => node.type === "Loader2")[0].props.className,
    "h-4 w-4 animate-spin",
  );
  await f.respond();
  f.button("Copy translation").props.onClick();
  await settle();
  assert.equal(elements(f.render(), (node) => node.type === "Check")[0].props.className, "h-5 w-5");
  assert.doesNotMatch(
    source,
    /rounded-full|rounded-2xl|rounded-\[24px\]|\bh-10\b|\bmin-h-10\b|text-\[30px\]|text-\[34px\]|tracking-\[-/,
  );
});
