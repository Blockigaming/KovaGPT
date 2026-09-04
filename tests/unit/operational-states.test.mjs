import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchJsonWithTimeout } from "../../src/lib/fetch-with-timeout.ts";
import { operationalStateForHttpStatus, waitForReadiness } from "../../src/lib/readiness-client.ts";

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
  assert.match(source, />\s*Retry\s*</u);
});

test("one readiness caller can abort without cancelling shared work", async () => {
  let complete;
  const shared = new Promise((resolve) => {
    complete = resolve;
  });
  const controller = new AbortController();
  const caller = waitForReadiness(shared, controller.signal);
  controller.abort(new DOMException("Caller left", "AbortError"));
  await assert.rejects(caller, (error) => error?.name === "AbortError");
  complete("ready");
  assert.equal(await shared, "ready");
});

test("readiness probes use a bounded shared transport", () => {
  const source = readFileSync("src/lib/readiness-client.ts", "utf8");
  assert.match(
    source,
    /fetchJsonWithTimeout<ClientReadiness>\([\s\S]*"\/api\/readyz"[\s\S]*10_000/u,
  );
  assert.doesNotMatch(source, /fetch\("\/api\/readyz", \{ signal/u);
  assert.match(source, /if \(!controller\.signal\.aborted\) setError\(true\)/u);
});

test("JSON fetch deadlines include response body consumption", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  });
  try {
    await assert.rejects(
      fetchJsonWithTimeout("/stalled-body", {}, 5),
      (error) => error?.name === "TimeoutError",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pre-aborted readiness callers are rejected before transport starts", () => {
  const source = readFileSync("src/lib/readiness-client.ts", "utf8");
  assert.match(source, /if \(signal\?\.aborted\)[\s\S]*throw signal\.reason/u);
  assert.ok(source.indexOf("if (signal?.aborted)") < source.indexOf("if (!pending)"));
});
