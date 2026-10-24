import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const { filterAcademyGuides, PUBLIC_ACADEMY_PAGES } = loadUiModule(
  "src/lib/public-academy-content.ts",
  {},
);
const slugs = (query) => Array.from(filterAcademyGuides(query), (guide) => guide.slug);

test("blank and whitespace-only searches preserve all 37 guides in catalog order", () => {
  assert.equal(PUBLIC_ACADEMY_PAGES.length, 37);
  for (const query of ["", " \t\n ", "---"]) {
    assert.equal(filterAcademyGuides(query), PUBLIC_ACADEMY_PAGES);
  }
});

test("search matches visible titles and summaries across case, accents, and spacing", () => {
  assert.deepEqual(slugs("  BRAINSTORM  "), ["brainstorming"]);
  assert.deepEqual(slugs(" MENTÁL\t\nMODEL "), ["ai-fundamentals"]);
  assert.deepEqual(slugs("MODEL mental"), ["ai-fundamentals"]);
  assert.deepEqual(slugs("multi-step"), ["chatgpt-work"]);
  assert.deepEqual(slugs("multi step"), ["chatgpt-work"]);
});

test("every search term must match the same guide; unmatched searches return no results", () => {
  assert.deepEqual(slugs("brainstorm student"), []);
  assert.deepEqual(slugs("zzzz-no-such-guide"), []);
  assert.deepEqual(slugs("[brainstorm].*"), ["brainstorming"]);
  // A hidden description keyword must not match a card whose visible text omits it.
  assert.ok(!slugs("uncertainty").includes("ai-fundamentals"));
});

test("filtered results retain original objects, order, and unique lesson destinations", () => {
  const results = filterAcademyGuides("coding");
  assert.ok(results.length > 1);
  const positions = Array.from(results, (guide) => PUBLIC_ACADEMY_PAGES.indexOf(guide));
  assert.ok(positions.every((position, index) => position > (positions[index - 1] ?? -1)));
  assert.equal(new Set(Array.from(results, (guide) => guide.slug)).size, results.length);
});
