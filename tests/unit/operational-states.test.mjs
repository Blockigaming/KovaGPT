import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { operationalStateForHttpStatus } from "../../src/lib/readiness-client.ts";

test("HTTP failures map to explicit user-facing operational states", () => {
  assert.equal(operationalStateForHttpStatus(401), "expired-auth");
  assert.equal(operationalStateForHttpStatus(403), "permission-denied");
  assert.equal(operationalStateForHttpStatus(429), "rate-limited");
  assert.equal(operationalStateForHttpStatus(504), "provider-timeout");
  assert.equal(operationalStateForHttpStatus(503), "unavailable");
  assert.equal(operationalStateForHttpStatus(400), "degraded");
});

test("operational state component has accessible copy and retry boundaries", () => {
  const source = readFileSync("src/components/OperationalState.tsx", "utf8");
  for (const state of ["expired-auth", "permission-denied", "rate-limited"]) {
    assert.match(source, new RegExp(`"${state}"`, "u"));
  }
  assert.match(source, /role=\{urgent \? "alert" : "status"\}/u);
  assert.match(source, /data-operational-state=\{state\}/u);
  assert.match(source, /"rate-limited"/u);
  assert.match(source, />Retry</u);
});
