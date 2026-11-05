import test from "node:test";
import assert from "node:assert/strict";
import { validateKovaActivityEvent, kovaActivityDisplay } from "./kova-activity-events.mjs";

const event = {
  id: "tool-123", type: "web_search", state: "completed",
  label: "Search results retrieved", domain: "example.com",
  timestamp: 1793900000000,
};
test("renders verified completed web activity", () => {
  assert.equal(kovaActivityDisplay(event).statusText, "Searched");
  assert.equal(kovaActivityDisplay(event).iconDomain, "example.com");
});
test("rejects arbitrary extra actions and invalid domains", () => {
  assert.equal(validateKovaActivityEvent({ ...event, execute: "alert(1)" }), null);
  assert.equal(validateKovaActivityEvent({ ...event, domain: "javascript:alert(1)" }), null);
});
test("failed events are not marked as completed", () => {
  assert.equal(kovaActivityDisplay({ ...event, state: "failed" }).statusText, "Could not complete");
});
