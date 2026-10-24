import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

const registry = loadUiModule("src/lib/review-page-content.ts", {});
const families = [
  "voice",
  "assistant",
  "media",
  "team",
  "legal",
  "request",
  "infrastructure",
  "developer",
];
const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));

// Execute the directory and shared picker with explicit hook/router primitives.
// Remounts model returning from a detail route, not native browser history or focus.
function fixture(family) {
  let directoryHooks = createHookHarness();
  let pickerHooks = createHookHarness();
  const react = (current) =>
    Object.fromEntries(
      ["useState", "useEffect", "useRef"].map((name) => [
        name,
        (...args) => current().react[name](...args),
      ]),
    );
  const picker = loadUiModule("src/components/ui/searchable-picker.tsx", {
    react: react(() => pickerHooks),
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
  const { ReviewDirectory } = loadUiModule("src/components/public/ReviewWorkspace.tsx", {
    react: react(() => directoryHooks),
    "./ReviewFamilySurface": { ReviewFamilySurface: "ReviewFamilySurface" },
    "@/components/auth/ClerkSafe": { useUser: () => ({ isLoaded: true }) },
    "@tanstack/react-router": { Link: "Link" },
    "./PublicShell": { PublicShell: "PublicShell" },
    "@/components/ui/searchable-picker": picker,
    "@/lib/review-page-content": registry,
  });
  let tree;
  const render = () => (tree = directoryHooks.render(ReviewDirectory, { family }));
  const control = () => elements(tree, (node) => node.type === picker.SearchablePicker)[0];
  const renderPicker = () => pickerHooks.render(picker.SearchablePicker, control().props);
  const list = () => {
    const child = elements(renderPicker(), (node) => node.type === picker.SearchablePickerList)[0];
    return picker.SearchablePickerList(child.props);
  };
  render();
  return {
    get tree() {
      return tree;
    },
    control,
    render,
    renderPicker,
    list,
    query: () => elements(tree, (node) => node.type === "input" && node.props.type === "search")[0],
    search(value) {
      this.query().props.onChange({ target: { value } });
      render();
    },
    select(value) {
      elements(
        list(),
        (node) => node.type === "CommandItem" && node.props.value === `option:${value}`,
      )[0].props.onSelect();
      render();
    },
    remount(nextFamily = family) {
      directoryHooks.unmount();
      pickerHooks.unmount();
      directoryHooks = createHookHarness();
      pickerHooks = createHookHarness();
      family = nextFamily;
      render();
    },
  };
}

const cards = (tree) =>
  elements(tree, (node) => node.type === "Link" && node.props.className === "spec400-review-card");
const count = (tree) =>
  text(elements(tree, (node) => node.props.role === "status")[0]).replace(/\s+/g, " ");

test("Page family uses a labelled searchable field with the exact nine existing choices", () => {
  const view = fixture();
  const control = view.control();
  assert.deepEqual(
    Array.from(control.props.options, ({ value, label }) => [value, label]),
    [["all", "All families"], ...families.map((family) => [family, family])],
  );
  const popup = view.renderPicker();
  assert.equal(popup.type, "Popover");
  assert.equal(elements(view.tree, (node) => node.type === "select").length, 0);
  const trigger = elements(popup, (node) => node.type === "button")[0];
  const label = elements(
    view.tree,
    (node) => node.props.id === trigger.props["aria-labelledby"],
  )[0];
  assert.equal(text(label), "Page family");
  assert.equal(
    elements(view.tree, (node) => node.type === "label" && node.props.htmlFor === trigger.props.id)
      .length,
    1,
  );
  assert.equal(trigger.props.type, "button");
  assert.equal(text(trigger).trim(), "All families");
  for (const token of ["w-full", "!justify-between", "!bg-background", "!px-3"])
    assert.ok(trigger.props.className.split(" ").includes(token), token);
  assert.equal(count(view.tree), `${registry.REVIEW_PAGES.length} review pages`);

  const list = view.list();
  const input = elements(list, (node) => node.type === "CommandInput")[0];
  assert.equal(input.props["aria-label"], "Search page families");
  assert.equal(input.props.autoFocus, true);
  assert.equal(list.props.filter("option:infrastructure", "  INFRA  ", ["infrastructure"]), 1);
  assert.equal(list.props.filter("option:voice", "absent", ["voice"]), 0);
  assert.equal(
    text(elements(list, (node) => node.type === "CommandEmpty")[0]),
    "No page families found.",
  );
  assert.equal(view.query().props.value, "", "Option search is separate from page search");
});

test("family selection preserves the page query and updates counts and ordinary detail destinations", () => {
  const view = fixture();
  view.search("REVIEW");
  for (const family of [...families, "all"]) {
    view.select(family);
    const expected = registry.REVIEW_PAGES.filter(
      (page) =>
        (family === "all" || page.family === family) &&
        `${page.title} ${page.summary}`.toLowerCase().includes("review"),
    );
    assert.equal(view.query().props.value, "REVIEW");
    assert.equal(view.control().props.value, family);
    assert.equal(count(view.tree), `${expected.length} review pages`);
    assert.deepEqual(
      cards(view.tree).map((card) => card.props.to),
      Array.from(expected, (page) => `/review/${page.slug}`),
    );
    for (const card of cards(view.tree)) assert.equal(card.props.onClick, undefined);
    assert.equal(view.renderPicker().props.open, false);
    const list = view.list();
    assert.equal(list.props.defaultValue, `option:${family}`);
    const selected = elements(
      list,
      (node) => node.type === "CommandItem" && node.props.value === `option:${family}`,
    )[0];
    assert.equal(elements(selected, (node) => node.type === "Check").length, 1);
  }
});

test("no-match recovery clears both existing filters and picker dismissal preserves them", () => {
  const view = fixture("legal");
  const query = "  unmatched family result\n ";
  view.search(query);
  view.select("infrastructure");
  assert.equal(view.query().props.value, query);
  assert.equal(count(view.tree), "0 review pages");
  assert.match(text(view.tree), /No matching review pages/);
  view.renderPicker().props.onOpenChange(true);
  assert.equal(view.renderPicker().props.open, true);
  view.renderPicker().props.onOpenChange(false);
  let prevented = false;
  elements(view.renderPicker(), (node) => node.type === "PopoverContent")[0].props.onCloseAutoFocus(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
  );
  assert.equal(prevented, false, "Keep the shared picker’s normal focus return");
  assert.equal(view.query().props.value, query);
  assert.equal(view.control().props.value, "infrastructure");
  elements(
    view.tree,
    (node) => node.type === "button" && text(node) === "Clear filters",
  )[0].props.onClick();
  view.render();
  assert.equal(view.query().props.value, "");
  assert.equal(view.control().props.value, "all");
  assert.equal(count(view.tree), `${registry.REVIEW_PAGES.length} review pages`);
  assert.doesNotMatch(text(view.tree), /No matching review pages/);
});

test("returning from detail preserves the selected family and query independently per directory", () => {
  const view = fixture();
  view.search("photo");
  view.select("media");
  const destinations = cards(view.tree).map((card) => card.props.to);
  assert.ok(destinations.length > 0);
  view.remount();
  assert.equal(view.query().props.value, "photo");
  assert.equal(view.control().props.value, "media");
  assert.deepEqual(
    cards(view.tree).map((card) => card.props.to),
    destinations,
  );
  view.remount("assistant");
  assert.equal(view.query().props.value, "");
  assert.equal(view.control().props.value, "assistant");
  view.search("profile");
  view.remount("legal");
  assert.equal(view.query().props.value, "");
  assert.equal(view.control().props.value, "legal");
  view.remount("assistant");
  assert.equal(view.query().props.value, "profile");
  assert.equal(view.control().props.value, "assistant");
});
