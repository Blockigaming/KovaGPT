import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const goal = fs.readFileSync("docs/day16/FINAL_GOAL.md", "utf8");

const additional = fs.readFileSync("docs/day16/ADDITIONAL_REQUIREMENTS.md", "utf8");

const ledger = JSON.parse(fs.readFileSync("docs/day16/MASTER_LEDGER.json", "utf8"));

const ledgerScript = fs.readFileSync("scripts/release/day16-ledger.mjs", "utf8");

test("the repository permanently records the canonical KovaGPT Finalized Goal", () => {
  const requirements = [
    "Cloudflare",
    "Supabase",
    "Microsoft Azure",
    "GPT-5.6 Sol",
    "Lovable must be completely removed from the production architecture",
    "entire visible UI must be complete and reliable",
    "ChatGPT-class capability set",
    "75% similar UI/UX interface to chatgpt / OpenAI",
    "320, 375, 390, 768, 1024, 1280, 1440, and 1728 px",
    "Security must be production-grade",
    "Azure migration must be complete",
    "production KovaGPT is running on the approved Azure architecture",
    "Cloudflare routes kovagpt.com correctly to that production stack",
    "GPT-5.6 Sol works end-to-end in production",
    "production contains zero active Lovable dependencies",
    "GitHub must end in a clean state",
    "browser E2E passes",
    "accessibility passes",
    "visual regression passes",
    "exact production release SHA",
    "100% complete",
    "deployed production system itself has been verified",
    "fully independent KovaGPT product running on Cloudflare + Supabase + Microsoft Azure + GPT-5.6 Sol",
    "no known P0/P1 bugs",
    "no unfinished visible functionality",
  ];

  for (const requirement of requirements) {
    assert.ok(goal.includes(requirement), `canonical goal is missing: ${requirement}`);
  }
});

test("later commercial requirements extend but never rewrite the canonical goal", () => {
  for (const requirement of [
    "reliable, privacy-safe product analytics",
    "referral and campaign attribution",
    "excellent onboarding",
    "truthful and well-timed upgrade prompts",
    "payment failure and past-due recovery",
    "cancellation feedback",
    "feature-to-upgrade attribution",
    "feature-to-subscription attribution",
    "churn and retention measurement",
    "real customer testimonials",
  ]) {
    assert.ok(additional.includes(requirement), `additional requirements missing: ${requirement}`);
  }

  assert.match(additional, /Testimonials must never be fabricated/);

  assert.match(additional, /do not modify or replace/);
});

test("canonical goal has a repository integrity digest", () => {
  const expected = crypto.createHash("sha256").update(goal).digest("hex");

  const recorded = fs.readFileSync("docs/day16/FINAL_GOAL.sha256", "utf8").trim().split(/\s+/)[0];

  assert.equal(recorded, expected);
});

test("the ledger cannot claim completion while production remains unverified", () => {
  const unresolvedProduction = ledger.items.filter(
    (item) =>
      item.required !== false &&
      item.verification === "production" &&
      item.status !== "verified_production" &&
      item.status !== "not_applicable",
  );

  assert.ok(unresolvedProduction.length > 0);

  assert.match(ledgerScript, /--require-complete/);

  assert.match(ledgerScript, /overallComplete/);
});

test("real testimonial evidence remains blocked until genuine approved customer evidence exists", () => {
  const testimonial = ledger.items.find((item) => item.id === "real_approved_testimonials");

  assert.ok(testimonial);

  assert.equal(testimonial.status, "blocked_external_evidence");

  assert.match(additional, /never be fabricated/);
});
