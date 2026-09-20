import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculatePhaseA } from "./phase-a-progress.mjs";
import { formatEvidenceLevel } from "./report-evidence.mjs";
const root = new URL("../../docs/interface-2026-09-19/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const fixture = () => [
  read("phase-a-ledger.json"),
  read("page-register.json"),
  read("capture-manifest.json"),
  read("source-observations.json"),
];
test("reproduces the historical score exactly without transferring it to expanded scope", () => {
  const result = calculatePhaseA(...fixture());
  assert.equal(result.historical.fraction, "65826560/2027091");
  assert.equal(result.historical.scope_pages, 212);
  assert.equal(result.current.percentage, null);
  assert.equal(result.current.scope_final, false);
  assert(result.current.blockers.length > 0);
});
test("source text earns no visual acceptance and merged aliases do not inflate active evidence", () => {
  const input = fixture();
  const result = calculatePhaseA(...input);
  assert.equal(result.current.newly_documented_source_pages, 36);
  assert.equal(result.current.fully_prepared_pages, 0);
  const withoutAlias = structuredClone(input);
  withoutAlias[3].pages = withoutAlias[3].pages.filter((p) => p.page_id !== "KOVA-0396");
  assert.equal(
    calculatePhaseA(...withoutAlias).current.newly_documented_source_pages,
    result.current.newly_documented_source_pages,
  );
});
test("report evidence labels follow the current register fields", () => {
  const page = {
    source_screenshot_status: "DESKTOP_VIEWPORT_REVIEWED",
    candidate_screenshot_status: "CAPTURED",
    full_page_and_controls_reviewed: "True",
    visual_accepted: "True",
  };
  assert.equal(
    formatEvidenceLevel(page),
    "Text reviewed · source screenshots: desktop viewport reviewed · candidate screenshots: captured · controls: reviewed · visual acceptance: accepted",
  );
});
test("rejects stale scope totals and invalid historical credit", () => {
  const input = fixture();
  input[1].plannedTargets++;
  assert.throws(() => calculatePhaseA(...input));
  const invalid = fixture();
  invalid[0].historical.categories[0].completed = 26;
  assert.throws(() => calculatePhaseA(...invalid));
});
test("rejects unknown or duplicate source observations", () => {
  const unknown = fixture();
  unknown[3].pages[0].page_id = "NONEXISTENT";
  assert.throws(() => calculatePhaseA(...unknown), /Unknown observation/);
  const duplicate = fixture();
  duplicate[3].pages.push(duplicate[3].pages[0]);
  assert.throws(() => calculatePhaseA(...duplicate), /Duplicate observation/);
});
test("app review decisions reconcile with route dispositions and valid canonical targets", () => {
  const data = read("app-route-review.json"),
    register = read("page-register.json");
  assert.equal(
    data.reviews.filter((x) => x.decision === "pending").length,
    register.unresolvedAppDefinitions,
  );
  assert.equal(
    data.route_dispositions.filter((x) => x.disposition === "SOURCE_REVIEW").length,
    register.unresolvedAppDefinitions,
  );
  assert.equal(new Set(data.reviews.map((x) => x.review_id)).size, data.reviews.length);
  for (const item of data.reviews.filter((x) => x.decision === "MAP_EXISTING_TARGET")) {
    assert(
      register.pages.some(
        (p) =>
          p.page_id === item.target_id &&
          !["MERGED_REFERENCE", "EXCLUDED_CODEX", "EXCLUDED_PROVIDER"].includes(
            p.completion_status,
          ),
      ),
    );
    const route = data.route_dispositions.find((x) => x.route_id === item.route_id);
    assert.equal(route.target_id, item.target_id);
    assert.equal(route.disposition, item.decision);
  }
});
test("every writing tool in the observed hub has exactly one source observation", () => {
  const observations = read("source-observations.json").pages;
  const hub = observations.find((x) => x.page_id === "KOVA-0203");
  assert.equal(hub.observed_tool_links.length, 21);
  for (const url of hub.observed_tool_links)
    assert.equal(observations.filter((x) => x.source_url === url).length, 1, url);
});
