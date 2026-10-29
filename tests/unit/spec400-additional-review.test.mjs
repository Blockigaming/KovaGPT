import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { Circle, Pause, Waves } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHookHarness, loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
const voiceIcons = { Circle, Pause, Waves };
const selectComponents = Object.fromEntries(
  ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
    name,
    name,
  ]),
);
const familySurface = loadUiModule("src/components/public/ReviewFamilySurface.tsx", {
  "@tanstack/react-router": { Link: "Link" },
  "lucide-react": voiceIcons,
  "@/components/ui/select": selectComponents,
});
const registry = loadUiModule("src/lib/review-page-content.ts", {});
const button = (tree, label) => elements(tree, (n) => n.type === "button" && text(n) === label)[0];
function harness(slug, principal = "owner-a", saved = new Map(), globals = {}) {
  const hooks = createHookHarness();
  const surface = Object.keys(globals).length
    ? loadUiModule(
        "src/components/public/ReviewFamilySurface.tsx",
        {
          "@tanstack/react-router": { Link: "Link" },
          "lucide-react": voiceIcons,
          "@/components/ui/select": selectComponents,
        },
        globals,
      )
    : familySurface;
  const module = loadUiModule(
    "src/components/public/ReviewWorkspace.tsx",
    {
      react: hooks.react,
      "./ReviewFamilySurface": surface,
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ user: { id: "owner-a" }, isLoaded: true }),
      },
      "@tanstack/react-router": { Link: "Link" },
      "./PublicShell": { PublicShell: "PublicShell" },
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@/lib/review-page-content": registry,
    },
    {
      sessionStorage: { getItem: (k) => saved.get(k), setItem: (k, v) => saved.set(k, v) },
      navigator: {
        clipboard: {
          writeText: async () => {
            throw Error("Blocked");
          },
        },
      },
      ...globals,
    },
  );
  const render = () =>
    hooks.render(() =>
      module.ReviewWorkspaceBody({
        page: registry.REVIEW_PAGE_BY_SLUG.get(slug),
        principal,
      }),
    );
  render();
  return { render, saved };
}
test("review catalog includes16media templates and excludes hiring routes", () => {
  assert.equal(registry.REVIEW_PAGES.filter((p) => p.family === "media").length, 23);
  assert.equal(
    registry.REVIEW_PAGES.some((p) => /career|recruit|residency|interview/.test(p.slug)),
    false,
  );
  for (const page of registry.REVIEW_PAGES)
    assert.equal(registry.findReviewPage(`review/${page.slug}`).title, page.title);
  assert.equal(registry.findReviewPage("voice"), undefined);
});
test("draft preview, save, reset cancellation and restore are local and preserve contents", () => {
  const h = harness("assistant-profile");
  let tree = h.render();
  elements(tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "Example instructions" },
  });
  tree = h.render();
  button(tree, "Save local draft").props.onClick();
  tree = h.render();
  assert.match(text(tree), /saved in this browser tab only/);
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  assert.match(text(tree), /Example instructions/);
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Cancel").props.onClick();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "textarea")[0].props.value, "Example instructions");
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Reset current draft").props.onClick();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "textarea")[0].props.value, "");
  button(tree, "Restore saved draft").props.onClick();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "textarea")[0].props.value, "Example instructions");
});
test("voice preview can start, pause, resume and stop without audio access", () => {
  const h = harness("voice");
  let tree = h.render();
  const indicator = (iconType, geometry) => {
    const region = elements(tree, (node) => node.props.className === "spec400-call-indicator")[0];
    assert.equal(region.props["aria-hidden"], "true");
    const icon = region.props.children;
    assert.equal(icon.type, iconType);
    // Render the actual installed icon selected by the source component. This
    // verifies SVG geometry, not a mock name or native computed dimensions.
    const svg = renderToStaticMarkup(createElement(icon.type, icon.props));
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /width="48"/);
    assert.match(svg, /height="48"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.equal((svg.match(/<circle\b/g) ?? []).length, geometry.circle ?? 0);
    assert.equal((svg.match(/<rect\b/g) ?? []).length, geometry.rect ?? 0);
    assert.equal((svg.match(/<path\b/g) ?? []).length, geometry.path ?? 0);
    assert.doesNotMatch(svg, /<text\b|○|Ⅱ|≋/);
  };
  indicator(Circle, { circle: 1 });
  assert.equal(button(tree, "Pause preview").props.disabled, true);
  assert.equal(button(tree, "End preview").props.disabled, true);
  const notes = elements(tree, (node) => node.type === "textarea")[0];
  notes.props.onChange({ target: { value: "Keep this local preview text" } });
  tree = h.render();
  button(tree, "Start text preview").props.onClick();
  tree = h.render();
  indicator(Waves, { path: 3 });
  assert.match(text(tree), /No call or recording is active/);
  assert.match(text(tree), /Keep this local preview text/);
  assert.equal(button(tree, "Pause preview").props.disabled, false);
  button(tree, "Pause preview").props.onClick();
  tree = h.render();
  indicator(Pause, { rect: 2 });
  assert.match(text(tree), /Preview paused/);
  assert.equal(button(tree, "Resume preview").props.disabled, false);
  button(tree, "Resume preview").props.onClick();
  tree = h.render();
  indicator(Waves, { path: 3 });
  assert.match(text(tree), /Preview open/);
  let returnedToStart = false;
  button(tree, "End preview").props.onClick({
    currentTarget: {
      parentElement: {
        querySelector: (selector) => {
          assert.equal(selector, "[data-review-call-start]");
          return {
            focus: () => {
              returnedToStart = true;
            },
          };
        },
      },
    },
  });
  assert.equal(returnedToStart, true);
  tree = h.render();
  indicator(Circle, { circle: 1 });
  assert.match(text(tree), /Microphone is off/);
  assert.equal(button(tree, "Pause preview").props.disabled, true);
  assert.equal(button(tree, "End preview").props.disabled, true);
  assert.equal(
    elements(tree, (node) => node.type === "textarea")[0].props.value,
    "Keep this local preview text",
  );
  assert.equal(elements(tree, (node) => node.props.className === "spec400-transcript").length, 0);
});

test("voice indicator uses the centered circular ChatGPT voice preview and color tokens", () => {
  const css = readFileSync("src/components/public/spec400-public.css", "utf8");
  const indicator = css.match(/\[data-public-shell\] \.spec400-call-indicator\s*\{([^}]+)\}/)[1];
  for (const declaration of [
    "display: grid;",
    "place-items: center;",
    "width: 128px;",
    "height: 128px;",
    "min-height: 128px;",
    "background: var(--muted);",
    "border-radius: 50%;",
    "margin: 24px auto;",
  ])
    assert.ok(indicator.includes(declaration), declaration);
});
test("clipboard failure preserves draft and gives a usable fallback", async () => {
  const h = harness("team-sharing");
  let tree = h.render();
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  await button(tree, "Copy draft").props.onClick();
  tree = h.render();
  assert.match(text(tree), /Copy failed/);
  assert.equal(elements(tree, (n) => n.type === "pre").length, 1);
});
test("review runtime has no service calls, recording, billing or fake shared links", () => {
  const source = readFileSync("src/components/public/ReviewWorkspace.tsx", "utf8");
  assert.doesNotMatch(
    source,
    /fetch\(|getUserMedia|MediaRecorder|speechSynthesis|\/api\/|createShared|stripe/,
  );
  assert.match(source, /serviceConnected:false|serviceConnected: false/);
  const css = readFileSync("src/components/public/spec400-public.css", "utf8");
  assert.doesNotMatch(css, /#(?:[a-fA-F0-9]{3,8})\b/);
  const sheet = postcss.parse(css);
  const headingSelector = "[data-public-shell] :is(main h1, .public-hero h1, .legal-hero h1)";
  const heading = sheet.nodes.find(
    (node) => node.type === "rule" && node.selector === headingSelector,
  );
  const declaration = (rule, property) =>
    rule.nodes.find((node) => node.type === "decl" && node.prop === property)?.value;
  assert.equal(
    declaration(heading, "font-family"),
    "var(--font-ui, ui-sans-serif, system-ui, sans-serif)",
  );
  assert.equal(declaration(heading, "font-size"), "clamp(36px, 5vw, 60px)");
  assert.equal(declaration(heading, "line-height"), "1.1");
  assert.equal(declaration(heading, "font-weight"), "400");
  const phoneHeading = sheet.nodes
    .filter(
      (node) =>
        node.type === "atrule" && node.name === "media" && node.params === "(max-width: 639px)",
    )
    .flatMap((node) => node.nodes)
    .find((node) => node.type === "rule" && node.selector.includes(headingSelector));
  assert.ok(phoneHeading, "public headings have an explicit narrow-phone rule");
  assert.equal(declaration(phoneHeading, "font-size"), "32px");
  assert.equal(declaration(phoneHeading, "line-height"), "38px");
});

test("saved review drafts are principal-scoped and never restored into another account", () => {
  const saved = new Map();
  const a = harness("assistant-profile", "owner-a", saved);
  let tree = a.render();
  elements(tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "Account A example" },
  });
  tree = a.render();
  button(tree, "Save local draft").props.onClick();
  assert.ok(saved.has("kova-review:owner-a:assistant-profile"));
  const b = harness("assistant-profile", "owner-b", saved);
  tree = b.render();
  button(tree, "Restore saved draft").props.onClick();
  tree = b.render();
  assert.equal(elements(tree, (n) => n.type === "textarea")[0].props.value, "");
  assert.match(text(tree), /No saved draft/);
  const source = readFileSync("src/components/public/ReviewWorkspace.tsx", "utf8");
  assert.match(source, /key=\{`\$\{principal\}:\$\{page.slug\}`\}/);
});
test("download errors retain preview and do not report completion", () => {
  const h = harness("legal-baa");
  let tree = h.render();
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  button(tree, "Download draft JSON").props.onClick();
  tree = h.render();
  assert.match(text(tree), /Download could not start/);
  assert.equal(elements(tree, (n) => n.type === "pre").length, 1);
});

test("all local review configurations resolve through the existing detail loader with noindex metadata", async () => {
  const { Route } = loadUiModule("src/routes/$section.$articleSlug.tsx", {
    "@tanstack/react-router": {
      createFileRoute: () => (options) => options,
      notFound: () => Error("Not found"),
      redirect: (options) => options,
    },
    "@/lib/publications": {
      publicationKey: (section, slug) => `${section}/${slug}`,
      PUBLICATION_BY_KEY: new Map(),
    },
    "@/components/public/PublicSite": { PublicDetailPageView: "Detail", PublicPageView: "Page" },
    "@/components/public/ReviewWorkspace": { ReviewWorkspace: "Review" },
    "@/lib/review-page-content": registry,
    "@/lib/seo-policy.mjs": { isPublicIndexableRoute: () => false },
  });
  for (const page of registry.REVIEW_PAGES) {
    const result = await Route.loader({ params: { section: "review", articleSlug: page.slug } });
    assert.equal(result.kind, "review");
    assert.equal(result.item.slug, page.slug);
    assert.equal(
      Route.head({ loaderData: result }).meta.find((meta) => meta.name === "robots").content,
      "noindex, nofollow",
    );
  }
});

test("legal pages lead with read-only status and keep questions secondary", () => {
  const h = harness("legal-baa");
  const tree = h.render();
  assert.equal(
    elements(tree, (n) => n.type === "h2")[0].props.children,
    "No approved document supplied",
  );
  assert.equal(elements(tree, (n) => n.type === "input" && !n.props.type).length, 0);
  assert.match(text(tree), /Covered parties and permitted use/);
  assert.ok(elements(tree, (n) => n.type === "details").length >= 2);
});
test("team retention exposes specific fields and an accurate local proposal summary", () => {
  const h = harness("team-retention");
  let tree = h.render();
  elements(tree, (n) => n.type === "input" && n.props.type === "number")[0].props.onChange({
    target: { value: "45" },
  });
  elements(tree, (n) => n.type === "Select")[0].props.onValueChange("Files proposal");
  tree = h.render();
  assert.match(text(tree), /45 days proposed/);
  assert.match(text(tree), /Files proposal/);
  assert.match(text(tree), /No organization policy is active or changed/);
});
test("photo editing omits unrelated video controls while loop planning has them", () => {
  const photo = harness("media-photo-edit").render();
  assert.match(text(photo), /Editing instruction/);
  assert.doesNotMatch(text(photo), /Frame role proposal|Include audio in brief|720p/);
  const loop = harness("media-loop").render();
  assert.match(text(loop), /Frame role proposal/);
  assert.match(text(loop), /Loop transition/);
});
test("voice leads with the call state and teaching leads with manual steps", () => {
  const voice = harness("voice").render();
  assert.equal(elements(voice, (n) => n.type === "h2")[0].props.children, "Call preview");
  const h = harness("assistant-teach");
  let tree = h.render();
  elements(tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "Open the draft\nReview the contents" },
  });
  tree = h.render();
  assert.match(text(tree), /Write task steps/);
  assert.equal(elements(tree, (n) => n.type === "ol")[0].props.children.length, 2);
  assert.match(text(tree), /recording is unavailable/);
});
test("family surfaces retain the no-provider boundary", () => {
  assert.doesNotMatch(
    readFileSync("src/components/public/ReviewFamilySurface.tsx", "utf8"),
    /fetch\(|getUserMedia|MediaRecorder|speechSynthesis|\/api\/|createShared|stripe/,
  );
});

test("inline reset and export close restore their initiating controls", () => {
  const h = harness("team-retention");
  let tree = h.render();
  const focused = [];
  button(tree, "Reset draft").props.ref.current = { focus: () => focused.push("reset") };
  button(tree, "Preview draft").props.ref.current = { focus: () => focused.push("preview") };
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Cancel").props.onClick();
  tree = h.render();
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Reset current draft").props.onClick();
  tree = h.render();
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  button(tree, "Close preview").props.onClick();
  assert.deepEqual(focused, ["reset", "reset", "preview"]);
  const source = readFileSync("src/components/public/ReviewWorkspace.tsx", "utf8");
  assert.match(source, /resetCancelRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /resetCancelRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /previewPanelRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("review headings keep one service boundary and compact empty media geometry", () => {
  const h = harness("media-photo-edit");
  const tree = h.render();
  assert.equal(elements(tree, (n) => n.props?.className === "spec400-lede").length, 0);
  assert.equal(elements(tree, (n) => n.props?.className === "spec400-review-boundary").length, 1);
  const empty = elements(tree, (n) => n.props?.["data-empty"] === true)[0];
  assert.equal(empty.props.style, undefined);
  const css = readFileSync("src/components/public/spec400-public.css", "utf8");
  assert.match(css, /data-empty="true"[^}]*height: 96px;/s);
  const phoneHeading = postcss
    .parse(css)
    .nodes.filter(
      (node) =>
        node.type === "atrule" && node.name === "media" && node.params === "(max-width: 639px)",
    )
    .flatMap((node) => node.nodes)
    .find(
      (node) =>
        node.type === "rule" &&
        node.selector.includes("[data-public-shell] :is(main h1, .public-hero h1, .legal-hero h1)"),
    );
  assert.ok(phoneHeading, "review headings inherit the shared phone hierarchy");
  assert.equal(phoneHeading.nodes.find((node) => node.prop === "font-size").value, "32px");
  assert.equal(phoneHeading.nodes.find((node) => node.prop === "line-height").value, "38px");
  const overview = readFileSync("src/components/public/ProductOverview.tsx", "utf8");
  assert.doesNotMatch(overview, /✧/);
});

test("media API brief previews and restores specific local requirements without inventing a request", () => {
  const h = harness("api-imagine");
  let tree = h.render();
  const fields = elements(tree, (n) => n.type === "textarea");
  fields[0].props.onChange({ target: { value: "Owned PNG reference" } });
  fields[1].props.onChange({ target: { value: "Square catalog image" } });
  fields[2].props.onChange({ target: { value: "Human review before publishing" } });
  tree = h.render();
  assert.match(text(tree), /Local integration summary/);
  assert.match(text(tree), /Owned PNG reference/);
  assert.match(text(tree), /No executable request/);
  button(tree, "Save local draft").props.onClick();
  tree = h.render();
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Reset current draft").props.onClick();
  tree = h.render();
  button(tree, "Restore saved draft").props.onClick();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "textarea")[0].props.value, "Owned PNG reference");
  assert.doesNotMatch(text(tree), /sk-proj-|curl |api_key=/);
});

test("assistant notifications show only their actual service state", () => {
  const h = harness("assistant-notifications");
  const content = text(h.render());
  assert.match(content, /Notification service unavailable/);
  assert.doesNotMatch(
    content,
    /support request identifier|No local instructions entered|Availability and preview/,
  );
});

test("removing a local media reference clears and focuses its chooser without changing instructions", () => {
  const calls = [];
  const input = { value: "reference.png", focus: () => calls.push("focus") };
  const tree = familySurface.ReviewFamilySurface({
    page: registry.REVIEW_PAGE_BY_SLUG.get("media-photo-edit"),
    draft: { ratio: "1:1", notes: "Keep the composition" },
    update: () => {
      throw Error("Instructions must remain unchanged");
    },
    reference: { name: "reference.png", url: "blob:local-fixture" },
    referenceInputRef: { current: input },
    setReference: (value) => calls.push(value),
    setStatus: (value) => calls.push(value),
    call: "idle",
    setCall: () => {},
  });
  button(tree, "Remove local reference").props.onClick({
    currentTarget: { closest: () => ({ querySelector: () => input }) },
  });
  assert.equal(input.value, "");
  assert.deepEqual(calls, [
    null,
    "Local reference removed. Your instructions are unchanged.",
    "focus",
  ]);
});

test("review directory filters survive detail unmount and stay separate by directory", () => {
  let hooks = createHookHarness();
  const react = Object.fromEntries(
    ["useState", "useEffect", "useRef"].map((name) => [
      name,
      (...args) => hooks.react[name](...args),
    ]),
  );
  const module = loadUiModule("src/components/public/ReviewWorkspace.tsx", {
    react,
    "./ReviewFamilySurface": familySurface,
    "@/components/auth/ClerkSafe": { useUser: () => ({ isLoaded: true }) },
    "@tanstack/react-router": { Link: "Link" },
    "./PublicShell": { PublicShell: "PublicShell" },
    "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
    "@/lib/review-page-content": registry,
  });
  const render = (family) => hooks.render(() => module.ReviewDirectory({ family }));
  let tree = render();
  elements(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "photo" } });
  elements(tree, (n) => n.type === "SearchablePicker")[0].props.onValueChange("media");
  render();
  hooks.unmount();
  hooks = createHookHarness();
  tree = render();
  assert.equal(elements(tree, (n) => n.type === "input")[0].props.value, "photo");
  assert.equal(elements(tree, (n) => n.type === "SearchablePicker")[0].props.value, "media");
  assert.match(text(tree), /Photo editing/);
  hooks.unmount();
  hooks = createHookHarness();
  tree = render("legal");
  assert.equal(elements(tree, (n) => n.type === "input")[0].props.value, "");
  assert.equal(elements(tree, (n) => n.type === "SearchablePicker")[0].props.value, "legal");
  elements(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "unmatched" } });
  tree = render("legal");
  button(tree, "Clear filters").props.onClick();
  render("legal");
  hooks.unmount();
  hooks = createHookHarness();
  tree = render("legal");
  assert.equal(elements(tree, (n) => n.type === "input")[0].props.value, "");
  assert.equal(elements(tree, (n) => n.type === "SearchablePicker")[0].props.value, "all");
});

test("confirmed media reset clears the native chooser and retains the saved draft", () => {
  const revoked = [];
  const h = harness("media-photo-edit", "owner-a", new Map(), {
    URL: {
      createObjectURL: () => "blob:reference",
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  let tree = h.render();
  const chooser = elements(tree, (n) => n.type === "input" && n.props.type === "file")[0];
  const nativeInput = { value: "reference.png" };
  chooser.props.ref.current = nativeInput;
  const instruction = elements(tree, (n) => n.type === "textarea")[0];
  instruction.props.onChange({ target: { value: "Keep this instruction" } });
  chooser.props.onChange({ target: { files: [{ name: "reference.png", type: "image/png" }] } });
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "img").length, 1);
  button(tree, "Save local draft").props.onClick();
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Cancel").props.onClick();
  assert.equal(nativeInput.value, "reference.png");
  tree = h.render();
  button(tree, "Reset draft").props.onClick();
  tree = h.render();
  button(tree, "Reset current draft").props.onClick();
  tree = h.render();
  assert.equal(nativeInput.value, "");
  assert.equal(elements(tree, (n) => n.type === "img").length, 0);
  assert.deepEqual(revoked, ["blob:reference"]);
  button(tree, "Restore saved draft").props.onClick();
  tree = h.render();
  assert.equal(
    elements(tree, (n) => n.type === "textarea")[0].props.value,
    "Keep this instruction",
  );
  assert.equal(elements(tree, (n) => n.type === "img").length, 0);
});

test("Preview draft reopens and focuses an export disclosure collapsed through its summary", () => {
  const h = harness("team-retention");
  let tree = h.render();
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  const panel = elements(tree, (n) => n.type === "details" && n.props.onToggle)[0];
  const calls = [];
  panel.props.ref.current = {
    focus: () => calls.push("focus"),
    scrollIntoView: () => calls.push("scroll"),
  };
  panel.props.onToggle({ currentTarget: { open: false } });
  tree = h.render();
  assert.equal(
    elements(tree, (n) => n.type === "details" && n.props.onToggle)[0].props.open,
    false,
  );
  button(tree, "Preview draft").props.onClick();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "details" && n.props.onToggle)[0].props.open, true);
  assert.deepEqual(calls, ["focus", "scroll"]);
  assert.equal(elements(tree, (n) => n.type === "pre").length, 1);
});

test("read-only Team usage does not imply an unfinished policy proposal", () => {
  const view = harness("team-usage");
  const tree = view.render();
  const copy = text(tree);
  assert.match(copy, /No team usage source is connected/);
  for (const label of ["Reporting period", "Member usage", "License allocation"])
    assert.ok(copy.includes(label));
  for (const label of [
    "Example label",
    "Proposed change summary",
    "No organization policy is active or changed",
  ])
    assert.ok(!copy.includes(label));
});

for (const [slug, expected] of [
  ["assistant-computer", "No computer connected"],
  ["assistant-shared-output", "No published output is selected"],
]) {
  test(`${slug} does not imply unavailable local instruction controls`, () => {
    const tree = harness(slug).render();
    const copy = text(tree);
    assert.ok(copy.includes(expected));
    assert.ok(!copy.includes("Availability and preview"));
    assert.ok(!copy.includes("No local instructions entered"));
    const surface = elements(
      tree,
      (node) => node.props?.["data-family-surface"] === "assistant-configuration",
    )[0];
    assert.equal(surface.props.className, undefined);
  });
}
