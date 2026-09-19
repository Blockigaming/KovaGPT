import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../docs/interface-2026-09-19/", import.meta.url);
const excluded = new Set(["MERGED_REFERENCE", "EXCLUDED_PROVIDER", "EXCLUDED_CODEX"]);
const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
export function calculatePhaseA(ledger, register, captures, observations) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(
    ledger.historical.categories.reduce((n, c) => n + c.weight, 0),
    100,
  );
  let numerator = 0n,
    denominator = 1n;
  const categories = ledger.historical.categories.map((c) => {
    for (const value of [c.weight, c.completed, c.required]) assert(Number.isSafeInteger(value));
    assert(c.required > 0 && c.completed >= 0 && c.completed <= c.required && c.weight >= 0);
    const n = BigInt(c.weight * c.completed),
      d = BigInt(c.required);
    numerator = numerator * d + n * denominator;
    denominator *= d;
    const common = gcd(numerator, denominator);
    numerator /= common;
    denominator /= common;
    return { ...c, earned_points: Number(n) / Number(d) };
  });
  const active = register.pages.filter((p) => !excluded.has(p.completion_status));
  assert.equal(active.length, register.plannedTargets);
  const knownIds = new Set(register.pages.map((p) => p.page_id));
  assert.equal(knownIds.size, register.pages.length, "Duplicate register IDs");
  const sourceReviewed = new Set();
  for (const observation of observations.pages) {
    assert(knownIds.has(observation.page_id), `Unknown observation: ${observation.page_id}`);
    assert(
      !sourceReviewed.has(observation.page_id),
      `Duplicate observation: ${observation.page_id}`,
    );
    assert(
      observation.source_url && observation.method && observation.limitations?.length,
      "Evidence needs a URL, method and limitations",
    );
    sourceReviewed.add(observation.page_id);
  }
  assert.equal(
    register.unresolvedPublicCandidates,
    active.filter((p) => p.completion_status === "CANDIDATE_REVIEW").length,
  );
  const fullPrepared = active.filter(
    (p) =>
      p.spec_complete === "True" &&
      p.full_page_and_controls_reviewed === "True" &&
      p.source_desktop_capture === "True" &&
      p.source_mobile_capture === "True",
  );
  return {
    historical: {
      scope_pages: ledger.historical.scope_pages,
      fraction: `${numerator}/${denominator}`,
      percentage: Number(numerator) / Number(denominator),
      categories,
      status: "historical_only_not_current_scope",
    },
    current: {
      percentage: null,
      status: "unscorable_until_expanded_scope_denominators_and_credits_are_reconciled",
      scope_final: register.scopeCompletelyResolved,
      active_targets: active.length,
      tracked_records: register.pages.length,
      unresolved_public_candidates: register.unresolvedPublicCandidates,
      unresolved_app_definitions: register.unresolvedAppDefinitions,
      newly_documented_source_pages: active.filter((p) => sourceReviewed.has(p.page_id)).length,
      text_review_is_not_visual_review: true,
      capture_records: captures.captures.length,
      fully_prepared_pages: fullPrepared.length,
      blockers: ledger.current_blockers,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
  const report = calculatePhaseA(
    read("phase-a-ledger.json"),
    read("page-register.json"),
    read("capture-manifest.json"),
    read("source-observations.json"),
  );
  const recordIndex = process.argv.indexOf("--record");
  if (recordIndex >= 0) {
    const label = process.argv[recordIndex + 1];
    assert(label?.trim(), "Supply a meaningful step description");
    const path = fileURLToPath(new URL("phase-a-history.json", root));
    const history = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
    history.push({
      step: history.length + 1,
      recorded_at: new Date().toISOString(),
      label,
      historical_point_delta: history.length
        ? report.historical.percentage - history.at(-1).report.historical.percentage
        : 0,
      report,
    });
    writeFileSync(path, JSON.stringify(history, null, 2) + "\n");
  }
  if (process.argv.includes("--write"))
    writeFileSync(new URL("phase-a-progress.json", root), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
