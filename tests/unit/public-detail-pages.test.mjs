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
  assert.match(view, /\["students", "\/use-cases\/students"\]/u);
  assert.match(view, /\["translate", "\/translation"\]/u);
  assert.match(view, /\["writing", "\/ai-writer"\]/u);
  assert.match(view, /DETAIL_SECTION_LANDINGS\.get\(item\.section\)/u);
  assert.match(view, /data-public-primary/u);
  assert.match(view, /item\.primaryAction\.to/u);
  assert.match(view, /item\.sections\.map/u);
  assert.match(view, /Page highlights/u);
});

test("business and app guidance actions lead to their intended public flows", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.match(source, /label: "Discuss requirements", to: "\/contact-sales"/u);
  assert.match(source, /label: "App connection guidance", to: "\/features\/plugins"/u);
  assert.doesNotMatch(source, /label: "Discuss requirements", to: "\/contact-support"/u);
  assert.doesNotMatch(source, /label: "App connection guidance", to: "\/connect"/u);
});

test("Google Drive guidance describes the unified Google authorization grant", () => {
  const source = read("src/lib/public-detail-content.ts");
  assert.match(source, /Review the unified Google grant for Drive, Gmail, and Calendar access/u);
  assert.doesNotMatch(source, /only requested Drive scopes/iu);
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
