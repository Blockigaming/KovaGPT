import test from "node:test";
import assert from "node:assert/strict";
import { canDisplayResponseAd, hasAdSenseConsent } from "../../src/lib/adsense-policy.mjs";
const free = { tier: "free", status: "ready", isLastAssistant: true, content: "Answer" };
test("ads fail closed for paid, unresolved, temporary, incomplete, and historical responses", () => {
  assert.equal(canDisplayResponseAd(free), true);
  for (const override of [
    { tier: "plus" },
    { tier: "pro" },
    { status: "loading" },
    { status: "unavailable" },
    { status: "signed_out" },
    { temporary: true },
    { streaming: true },
    { content: " " },
    { isLastAssistant: false },
    { generationStatus: "stopped" },
    { generationStatus: "error" },
  ]) {
    assert.equal(canDisplayResponseAd({ ...free, ...override }), false, JSON.stringify(override));
  }
});
test("missing, unsettled, rejected, or withdrawn CMP consent never enables ads", () => {
  const consent = {
    cmpStatus: "loaded",
    eventStatus: "useractioncomplete",
    purpose: { consents: { 1: true } },
    vendor: { consents: { 755: true } },
  };
  assert.equal(hasAdSenseConsent(consent, true), true);
  assert.equal(
    hasAdSenseConsent({ cmpStatus: "loaded", eventStatus: "tcloaded", gdprApplies: false }, true),
    true,
  );
  assert.equal(hasAdSenseConsent({ cmpStatus: "loaded", eventStatus: "tcloaded" }, true), false);
  for (const value of [
    undefined,
    {},
    { ...consent, cmpStatus: "error" },
    { ...consent, eventStatus: "cmpuishown" },
    { ...consent, purpose: { consents: { 1: false } } },
    { ...consent, vendor: { consents: { 755: false } } },
  ])
    assert.equal(hasAdSenseConsent(value, true), false);
  assert.equal(hasAdSenseConsent(consent, false), false);
});
