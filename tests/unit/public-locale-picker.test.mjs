import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

const catalog = loadUiModule("src/lib/locales.ts", {});
const supported = ["en", "es", "fr", "de", "pt-BR", "ja", "ko", "ar"];
const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));
// Source components with explicit router, hooks, and location stubs. No native
// popup placement, keyboard dispatch, or live navigation is exercised here.
function fixture(locale = "en") {
  const hooks = createHookHarness();
  const navigation = [];
  const picker = loadUiModule("src/components/ui/searchable-picker.tsx", {
    react: hooks.react,
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
  const notFound = new Error("not found");
  const { Route } = loadUiModule(
    "src/routes/$locale.home.tsx",
    {
      "@tanstack/react-router": {
        Link: "Link",
        notFound: () => notFound,
        createFileRoute: (path) => (config) => ({
          ...config,
          path,
          useLoaderData: () => ({ locale, copy: catalog.translations[locale] }),
        }),
      },
      "@/components/public/PublicSite": { PublicSite: "PublicSite" },
      "@/components/ui/searchable-picker": picker,
      "@/lib/locales": catalog,
    },
    { location: { assign: (url) => navigation.push(url) } },
  );
  const page = Route.component();
  const control = elements(page, (node) => node.type === picker.SearchablePicker)[0];
  const render = () => hooks.render(picker.SearchablePicker, control.props);
  const list = () => {
    const child = elements(render(), (node) => node.type === picker.SearchablePickerList)[0];
    return picker.SearchablePickerList(child.props);
  };
  return { Route, notFound, page, control, render, list, navigation };
}

test("all eight existing locales retain their current value, authored label, copy, and scoped direction", () => {
  assert.deepEqual(Array.from(catalog.SUPPORTED_LOCALES), supported);
  for (const locale of supported) {
    const f = fixture(locale);
    const main = elements(f.page, (node) => node.type === "main")[0];
    assert.equal(main.props.lang, locale);
    assert.equal(main.props.dir, locale === "ar" ? "rtl" : "ltr");
    const label = elements(
      f.page,
      (node) => node.props.id === f.control.props["aria-labelledby"],
    )[0];
    assert.equal(text(label), "Language");
    assert.equal(label.props.lang, "en");
    assert.equal(f.control.props.value, locale);
    assert.deepEqual(
      Array.from(f.control.props.options, (option) => [option.value, option.label]),
      supported.map((value) => [value, value]),
    );
    assert.equal(f.render().type, "Popover");
    assert.equal(elements(f.render(), (node) => node.type === "select").length, 0);
    const trigger = elements(f.render(), (node) => node.type === "button")[0];
    assert.equal(text(trigger).trim(), locale);
    assert.equal(trigger.props.dir, main.props.dir);
    assert.equal(
      elements(f.render(), (node) => node.type === "PopoverContent")[0].props.dir,
      main.props.dir,
    );
    assert.equal(
      elements(f.page, (node) => node.type === "h1")[0].props.children,
      catalog.translations[locale].title,
    );
    assert.deepEqual(f.navigation, []);
  }
});

test("locale search uses existing code labels, retains selected state, and navigates once to each supported local path", () => {
  const f = fixture("ar");
  const list = f.list();
  assert.equal(list.props.defaultValue, "option:ar");
  assert.equal(list.props.loop, true);
  const input = elements(list, (node) => node.type === "CommandInput")[0];
  assert.equal(input.props["aria-label"], "Search languages");
  assert.equal(input.props.placeholder, "Search languages");
  assert.equal(input.props.autoFocus, true);
  assert.equal(list.props.filter("option:pt-BR", "  PT-br ", ["pt-BR"]), 1);
  assert.equal(list.props.filter("option:ar", "unsupported", ["ar"]), 0);
  assert.equal(
    text(elements(list, (node) => node.type === "CommandEmpty")[0]),
    "No languages found.",
  );
  const items = elements(list, (node) => node.type === "CommandItem");
  assert.equal(items.length, 8);
  assert.equal(elements(items[7], (node) => node.type === "Check").length, 1);
  for (const item of items) item.props.onSelect();
  assert.deepEqual(
    f.navigation,
    supported.map((value) => `/${value}/home`),
  );
  assert.equal(f.render().props.open, false);
});

test("unsupported or path-like picker values never navigate, and dismissal keeps the locale", () => {
  const f = fixture("fr");
  for (const value of [
    "",
    "en-US",
    "AR",
    "zh",
    "../settings",
    "//outside.example",
    "https://outside.example",
    "ar?next=/settings",
    "ar#fragment",
    "%2fen",
  ])
    f.control.props.onValueChange(value);
  assert.deepEqual(f.navigation, []);
  f.render().props.onOpenChange(true);
  assert.equal(f.render().props.open, true);
  f.render().props.onOpenChange(false);
  assert.equal(f.render().props.open, false);
  assert.equal(f.control.props.value, "fr");
  assert.deepEqual(f.navigation, []);
});

test("locale route validation and canonical/alternate metadata remain restricted to the existing catalog", () => {
  const f = fixture();
  assert.equal(f.Route.path, "/$locale/home");
  for (const locale of supported) {
    const data = f.Route.loader({ params: { locale } });
    assert.equal(data.locale, locale);
    assert.equal(data.copy, catalog.translations[locale]);
    const head = f.Route.head({ loaderData: data });
    assert.equal(head.links[0].href, `https://kovagpt.com/${locale}/home`);
    assert.deepEqual(
      Array.from(head.links.slice(1, -1), (link) => [link.rel, link.hrefLang, link.href]),
      supported.map((value) => ["alternate", value, `https://kovagpt.com/${value}/home`]),
    );
    assert.equal(head.links.at(-1).hrefLang, "x-default");
    assert.equal(head.links.at(-1).href, "https://kovagpt.com/en/home");
    assert.equal(head.meta.find((item) => item.name === "robots").content, "noindex, follow");
    assert.equal(head.meta.find((item) => item.title).title, `${data.copy.title} | KovaGPT`);
    assert.equal(
      head.meta.find((item) => item.name === "description").content,
      data.copy.description,
    );
  }
  for (const locale of ["de-DE", "en-US", "zh", "../en", "AR"])
    assert.throws(
      () => f.Route.loader({ params: { locale } }),
      (error) => error === f.notFound,
    );
});

test("both shared prose eyebrows retain authored casing and colors without forced capitalization or tracking", () => {
  const { PublicPageView, PublicDetailPageView } = loadUiModule(
    "src/components/public/PublicSite.tsx",
    {
      "@tanstack/react-router": { Link: "Link" },
      "lucide-react": primitives(["ArrowRight", "CheckCircle2"]),
      "@/components/public/PublicFaq": { PublicFaq: "PublicFaq" },
      "@/components/public/PublicShell": { PublicShell: "PublicShell" },
    },
  );
  const item = {
    eyebrow: "Publishing",
    title: "Authored title",
    summary: "Authored summary",
    section: "features",
    slug: "example",
    primaryAction: { label: "Open", to: "/" },
    highlights: [],
    sections: [{ title: "Section", body: "Body", points: [] }],
  };
  for (const page of [
    PublicPageView({ ...item, children: "Body" }),
    PublicDetailPageView({ item }),
  ]) {
    const eyebrow = elements(page, (node) => node.type === "p" && text(node) === item.eyebrow);
    assert.equal(eyebrow.length, 1);
    assert.doesNotMatch(eyebrow[0].props.className, /uppercase|lowercase|capitalize|tracking-/);
    assert.match(eyebrow[0].props.className, /text-sm font-semibold text-muted-foreground/);
    assert.equal(text(elements(page, (node) => node.type === "h1")[0]), item.title);
    assert.ok(elements(page, (node) => node.type === "p" && text(node) === item.summary).length);
  }
  const counter = elements(
    PublicDetailPageView({ item }),
    (node) => node.type === "p" && text(node) === "01",
  )[0];
  assert.match(counter.props.className, /uppercase tracking-\[0\.14em\]/);
  assert.match(readFileSync("src/routes/$slug.tsx", "utf8"), /eyebrow="Publishing"/);
});
