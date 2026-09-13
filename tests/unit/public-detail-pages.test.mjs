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
  ]) {
    const [section, slug] = path.split("/");
    assert.match(source, new RegExp(`"${section}"[\\s\\S]*?"${slug}"`, "u"), path);
  }
  assert.match(source, /\["free", "plus", "pro"\] as const/u);
  assert.doesNotMatch(source, /"features",\s*"voice(?:-with-video)?"/u);
});

test("detail route provides unique metadata, breadcrumbs, sections, and real actions", () => {
  const route = read("src/routes/$section.$articleSlug.tsx");
  const view = read("src/components/public/PublicSite.tsx");
  assert.match(route, /PUBLIC_DETAIL_PAGE_BY_KEY/u);
  assert.match(route, /isPublicIndexableRoute/u);
  assert.match(route, /og:type/u);
  assert.match(view, /aria-label="Breadcrumb"/u);
  assert.match(view, /item\.primaryAction\.to/u);
  assert.match(view, /item\.sections\.map/u);
  assert.match(view, /Page highlights/u);
});
