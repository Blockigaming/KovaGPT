import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const register = JSON.parse(readFileSync("docs/day16/REMAINING_WORK.json", "utf8"));
const ledger = JSON.parse(readFileSync("docs/day16/MASTER_LEDGER.json", "utf8"));
const calculator = readFileSync("scripts/release/remaining-work.mjs", "utf8");
const diagnostic = readFileSync("scripts/release/diagnose-browser-runtime.mjs", "utf8");

const acceptedSource = new Set(["verified_local", "verified_production", "not_applicable"]);
const acceptedProduction = new Set(["verified_production", "not_applicable"]);
const required = ledger.items.filter((item) => item.required !== false);
const source = required.filter((item) => item.verification === "source");
const production = required.filter((item) => item.verification === "production");
const remaining = required.filter((item) =>
  item.verification === "production"
    ? !acceptedProduction.has(item.status)
    : !acceptedSource.has(item.status),
);

test("remaining-work register matches the authoritative high-level ledger", () => {
  assert.equal(required.length, 30);
  assert.equal(source.length, 13);
  assert.equal(production.length, 17);
  assert.equal(source.filter((item) => acceptedSource.has(item.status)).length, 12);
  assert.equal(production.filter((item) => acceptedProduction.has(item.status)).length, 0);
  assert.equal(remaining.length, 18);

  assert.deepEqual(register.highLevelLedger, {
    requiredGates: 30,
    verifiedGates: 12,
    remainingGates: 18,
    source: { verified: 12, total: 13, remaining: 1 },
    production: { verified: 0, total: 17, remaining: 17 },
  });
});

test("all 84 execution packages are unique and map to a required gate", () => {
  assert.equal(register.executionPackageCount, 84);
  assert.equal(register.packages.length, 84);
  assert.equal(new Set(register.packages.map((item) => item.id)).size, 84);

  const requiredIds = new Set(required.map((item) => item.id));
  for (const item of register.packages) {
    assert.match(item.id, /^[A-E]\d{2}$/u);
    assert.ok(requiredIds.has(item.gate), `${item.id} references unknown gate ${item.gate}`);
    assert.equal(typeof item.title, "string");
    assert.ok(item.title.length > 10);
    assert.equal(typeof item.acceptance, "string");
    assert.ok(item.acceptance.length > 10);
  }

  assert.deepEqual(register.phaseCounts, {
    local_source_closure: 9,
    feature_completion: 33,
    release_candidate_and_data: 10,
    azure_staging: 12,
    production_cutover: 20,
  });
});

test("cost policy preserves zero Lovable and one final Actions run", () => {
  assert.equal(register.costPolicy.lovableCredits, 0);
  assert.match(register.costPolicy.githubActions, /One manual final exact-SHA workflow only/u);
  assert.match(register.costPolicy.azure, /One consolidated staging deployment/u);
  assert.equal(register.costPolicy.potentiallyCostBearingPackages, 13);
  assert.doesNotMatch(JSON.stringify(register.packages), /lovable credit|lovable runtime/iu);
});

test("minimum browser acceptance is calculated as 100 active executions", () => {
  assert.equal(register.minimumVisualAcceptance.projectsPerAuthState, 24);
  assert.equal(register.minimumVisualAcceptance.primaryShellExecutionsPerAuthState, 48);
  assert.equal(register.minimumVisualAcceptance.activeExecutionsPerAuthState, 50);
  assert.equal(register.minimumVisualAcceptance.authStates, 2);
  assert.equal(register.minimumVisualAcceptance.minimumActiveExecutions, 100);
  assert.deepEqual(register.minimumVisualAcceptance.browsers, ["Chromium", "Firefox", "WebKit"]);
  assert.equal(register.minimumVisualAcceptance.viewports.length, 8);
});

test("remaining-work calculator and browser diagnostic remain repository-local", () => {
  assert.match(calculator, /docs\/day16\/MASTER_LEDGER\.json/u);
  assert.match(calculator, /KOVA_REMAINING_GATES/u);
  assert.match(calculator, /--require-complete/u);
  assert.match(diagnostic, /from "@playwright\/test"/u);
  assert.match(diagnostic, /BROWSER_RUNTIME_DIAGNOSTIC/u);
  assert.match(diagnostic, /sameOriginFatalEventCount/u);
});
