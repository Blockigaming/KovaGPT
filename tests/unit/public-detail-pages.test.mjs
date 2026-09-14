import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("public detail registry covers every approved missing marketing family", () => {
  const source = read("src/lib/public-detail-content.ts");
  for (const path of [
    "features/deep-research",
    "features/plugins",
    "features/study-mode",
    "features/chat-with-pdfs",
    "features/voice",
    "features/voice-with-video",
    "plans/go",
    "plans/k12-teachers",
    "use-cases/chat-with-presentations",
    "use-cases/chat-with-spreadsheets",
    "use-cases/fitness-wellness-and-health",
    "use-cases/money-and-finances",
    "use-cases/recipes-cooking",
    "use-cases/science-medicine",
    "use-cases/students",
    "use-cases/teachers",
    "use-cases/travel-and-exploration",
    "use-cases/university-educators",
    "use-cases/veterans",
    "business/ai-for-data-science-analytics",
    "business/ai-for-engineering",
    "business/ai-for-finance",
    "business/ai-for-product-management",
    "business/ai-for-sales-marketing",
    "business/education",
    "business/enterprise",
    "apps/google-drive",
    "apps/gmail",
    "apps/google-calendar",
    "apps/github",
    "apps/canva",
    "apps/powerpoint",
    "apps/spotify",
    "codex/enterprise",
    "codex/pricing",
    "students/2026",
    "translate/english-to-french",
    "translate/english-to-hindi",
    "translate/english-to-marathi",
    "translate/english-to-portuguese",
    "translate/english-to-tagalog",
    "translate/english-to-tamil",
    "translate/english-to-urdu",
    "translate/hindi-to-english",
    "translate/spanish-to-english",
    "translate/tagalog-to-english",
    "writing/paraphrase",
  ]) {
    const [section, slug] = path.split("/");
    assert.match(source, new RegExp(`"${section}"[\\s\\S]*?"${slug}"`, "u"), path);
  }
  assert.match(source, /\["free", "plus", "pro"\] as const/u);
  assert.match(source, /unavailableFeature\("voice", "Voice with KovaGPT"\)/u);
  assert.match(source, /No microphone permission is requested/u);
  assert.match(source, /unavailableApp\("canva", "Canva"\)/u);
  assert.match(source, /Not currently connectable/u);
  assert.match(source, /title: "Choose a working connection"/u);
  assert.match(source, /title: "Review available features"/u);
  assert.match(source, /title: "Compare active plans"/u);
});

test("Kova ecosystem references cover every plugin and partner path without false claims", async () => {
  const { PUBLIC_ECOSYSTEM_PATHS } = await import("../../src/lib/seo-policy.mjs");
  const source = read("src/lib/public-ecosystem-content.ts");
  const twoSegmentRoute = read("src/routes/$section.$articleSlug.tsx");
  const threeSegmentRoute = read("src/routes/$section.$category.$articleSlug.tsx");

  assert.equal(PUBLIC_ECOSYSTEM_PATHS.length, 177);
  assert.match(source, /KovaGPT does not currently represent/u);
  assert.match(source, /does not activate/u);
  assert.match(source, /No implied endorsement/u);
  assert.match(source, /supportedApps/u);
  assert.match(source, /PUBLIC_ECOSYSTEM_PAGES\.map/u);
  assert.match(twoSegmentRoute, /PUBLIC_ECOSYSTEM_PAGE_BY_KEY/u);
  assert.match(threeSegmentRoute, /PUBLIC_ECOSYSTEM_PAGE_BY_KEY/u);
});

test("detail route provides unique metadata, breadcrumbs, sections, and real actions", () => {
  const route = read("src/routes/$section.$articleSlug.tsx");
  const view = read("src/components/public/PublicSite.tsx");
  assert.match(route, /PUBLIC_DETAIL_PAGE_BY_KEY/u);
  assert.match(route, /await import\("@\/lib\/public-detail-content"\)/u);
  assert.ok(
    route.indexOf("PUBLICATION_BY_KEY.get(key)") <
      route.indexOf('await import("@/lib/public-detail-content")'),
  );
  assert.match(route, /isPublicIndexableRoute/u);
  assert.match(route, /og:type/u);
  assert.match(view, /aria-label="Breadcrumb"/u);
  assert.match(view, /\["students", \{ label: "students", to: "\/use-cases\/students" \}\]/u);
  assert.match(view, /\["form", \{ label: "contact support", to: "\/contact-support" \}\]/u);
  assert.match(view, /label: "trust and transparency", to: "\/trust-and-transparency"/u);
  assert.match(view, /\["translate", \{ label: "translation", to: "\/translation" \}\]/u);
  assert.match(view, /\["writing", \{ label: "AI writer", to: "\/ai-writer" \}\]/u);
  assert.match(view, /DETAIL_SECTION_LANDINGS\.get\(item\.section\)/u);
  assert.match(view, /sectionLanding\?\.label/u);
  assert.match(view, /data-public-primary/u);
  assert.match(view, /item\.primaryAction\.to/u);
  assert.match(view, /item\.closing \?\?/u);
  assert.match(view, /\{closing\.title\}/u);
  assert.match(view, /\{closing\.body\}/u);
  assert.match(view, /item\.sections\.map/u);
  assert.match(view, /Page highlights/u);
});

test("Kova form status pages cover every exact source path without collecting submissions", async () => {
  const source = read("src/lib/public-form-content.ts");
  const twoSegmentRoute = read("src/routes/$section.$articleSlug.tsx");
  const threeSegmentRoute = read("src/routes/$section.$category.$articleSlug.tsx");
  const { PUBLIC_FORM_PATHS } = await import("../../src/lib/seo-policy.mjs");

  assert.equal(PUBLIC_FORM_PATHS.length, 43);
  assert.equal(new Set(PUBLIC_FORM_PATHS).size, 43);
  assert.ok(PUBLIC_FORM_PATHS.every((path) => path.startsWith("/form/")));
  assert.match(source, /PUBLIC_FORM_PATHS\.map\(formPage\)/u);
  assert.match(source, /does not accept contact details, account credentials, documents/u);
  assert.match(source, /does not claim that the corresponding external program/u);
  assert.match(source, /label: "Return to KovaGPT", to: "\/"/u);
  for (const route of [twoSegmentRoute, threeSegmentRoute]) {
    assert.match(route, /PUBLIC_FORM_PAGE_BY_KEY/u);
    assert.match(route, /params\.section === "form"/u);
  }
});

test("Kova global-affairs pages cover every exact source path without importing claims", async () => {
  const source = read("src/lib/public-global-affairs-content.ts");
  const route = read("src/routes/$section.$articleSlug.tsx");
  const { PUBLIC_GLOBAL_AFFAIRS_PATHS } = await import("../../src/lib/seo-policy.mjs");
  assert.equal(PUBLIC_GLOBAL_AFFAIRS_PATHS.length, 50);
  assert.equal(new Set(PUBLIC_GLOBAL_AFFAIRS_PATHS).size, 50);
  assert.ok(PUBLIC_GLOBAL_AFFAIRS_PATHS.every((path) => path.startsWith("/global-affairs/")));
  assert.equal((source.match(/^  (?:"[^"]+"|[a-z][a-z0-9-]*):/gmu) ?? []).length, 50);
  assert.match(source, /PUBLIC_GLOBAL_AFFAIRS_PATHS\.map\(globalAffairsPage\)/u);
  assert.match(source, /does not import or republish the external announcement/u);
  assert.match(source, /No external relationship or participation is implied/u);
  assert.match(source, /This KovaGPT guide is not the external submission, legal text/u);
  assert.match(source, /partnership\|partners-with/u);
  assert.match(source, /introducing-openai-for-government/u);
  assert.match(source, /openai-for-countries\|partnership/u);
  assert.match(source, /title: "Verify the current status"/u);
  assert.match(route, /PUBLIC_GLOBAL_AFFAIRS_PAGE_BY_KEY/u);
  assert.match(route, /params\.section === "global-affairs"/u);
});

test("business and app guidance actions lead to their intended public flows", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.match(source, /label: "Discuss requirements", to: "\/contact-sales"/u);
  assert.match(source, /label: "App connection guidance", to: "\/features\/plugins"/u);
  assert.doesNotMatch(source, /label: "Discuss requirements", to: "\/contact-support"/u);
  assert.doesNotMatch(source, /label: "App connection guidance", to: "\/connect"/u);
});

test("every supported Google app describes the unified authorization grant", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.equal(
    source.match(/Review the unified Google grant for Drive, Gmail, and Calendar access/gu)?.length,
    3,
  );
  assert.doesNotMatch(source, /only requested Drive scopes/iu);
});

test("GitHub guidance describes the fixed OAuth grant truthfully", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.match(source, /fixed OAuth permissions/u);
  assert.match(source, /read:user, user:email, repo, read:org, and workflow OAuth request/u);
  assert.doesNotMatch(source, /Keep read and write scopes distinct/u);
});

test("the Free plan opens KovaGPT while paid plans continue to pricing", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.match(source, /to: tier === "free" \? "\/" : "\/pricing"/u);
});

test("Kova Academy provides all 38 exact-path, original learning guides", () => {
  const source = read("src/lib/public-academy-content.ts");
  const progress = JSON.parse(read("docs/ui-ux/page-by-page-progress.json"));
  const expected = progress.records
    .filter(
      ({ source, sourcePath }) => source === "openai.com" && sourcePath.startsWith("/academy/"),
    )
    .map(({ sourcePath }) => sourcePath.slice(1));
  const actual = [...source.matchAll(/\bslug:\s*"([^"]+)"/gu)].map(
    (match) => `academy/${match[1]}`,
  );
  assert.equal(expected.length, 38);
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.equal(new Set(actual).size, 38);
  assert.match(source, /PUBLIC_ACADEMY_PAGE_BY_KEY/u);
  assert.match(source, /Treat every generated answer as a draft/u);
  assert.doesNotMatch(source, /OpenAI Academy|ChatGPT Academy/u);

  const twoSegmentRoute = read("src/routes/$section.$articleSlug.tsx");
  const threeSegmentRoute = read("src/routes/$section.$category.$articleSlug.tsx");
  for (const route of [twoSegmentRoute, threeSegmentRoute]) {
    assert.match(route, /PUBLIC_ACADEMY_PAGE_BY_KEY/u);
    assert.match(route, /params\.section === "academy"/u);
  }
});

test("Kova policy references cover every exact source path without importing external terms", async () => {
  const source = read("src/lib/public-policy-content.ts");
  const twoSegmentRoute = read("src/routes/$section.$articleSlug.tsx");
  const threeSegmentRoute = read("src/routes/$section.$category.$articleSlug.tsx");
  const { PUBLIC_POLICY_PATHS } = await import("../../src/lib/seo-policy.mjs");

  assert.equal(PUBLIC_POLICY_PATHS.length, 62);
  assert.equal(new Set(PUBLIC_POLICY_PATHS).size, 62);
  assert.ok(PUBLIC_POLICY_PATHS.every((path) => path.startsWith("/policies/")));
  assert.match(source, /PUBLIC_POLICY_PATHS\.map\(policyPage\)/u);
  assert.match(source, /does not reproduce, adopt, replace, or summarize/u);
  assert.match(source, /not a standalone contract or policy edition/u);
  assert.match(twoSegmentRoute, /PUBLIC_POLICY_PAGE_BY_KEY/u);
  assert.match(threeSegmentRoute, /PUBLIC_POLICY_PAGE_BY_KEY/u);
});

test("Kova business resources cover every exact source path without unsupported claims", async () => {
  const source = read("src/lib/public-business-content.ts");
  const twoSegmentRoute = read("src/routes/$section.$articleSlug.tsx");
  const threeSegmentRoute = read("src/routes/$section.$category.$articleSlug.tsx");
  const fourSegmentRoute = read("src/routes/$section.$category.$subcategory.$articleSlug.tsx");
  const { PUBLIC_BUSINESS_PATHS } = await import("../../src/lib/seo-policy.mjs");

  assert.equal(PUBLIC_BUSINESS_PATHS.length, 49);
  assert.equal(new Set(PUBLIC_BUSINESS_PATHS).size, 49);
  assert.ok(PUBLIC_BUSINESS_PATHS.every((path) => path.startsWith("/business/")));
  assert.match(source, /PUBLIC_BUSINESS_PATHS\.map\(businessPage\)/u);
  assert.match(source, /No unsupported claim/u);
  assert.match(source, /No third-party relationship or endorsement is implied/u);
  assert.doesNotMatch(source, /guarantees? that capacity is available/iu);
  for (const route of [twoSegmentRoute, threeSegmentRoute, fourSegmentRoute]) {
    assert.match(route, /PUBLIC_BUSINESS_PAGE_BY_KEY/u);
    assert.match(route, /params\.section (?:===|!==) "business"/u);
  }
});
