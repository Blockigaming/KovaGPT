import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_MODEL,
  developerBrowserFields,
  developerBrowserOrigins,
  developerBrowserReceipt,
  validDeveloperBrowserRequest,
} from "../../src/lib/pricing/developer-browser-policy.mjs";

const url = "https://www.example.com/docs";
const body = { model: BROWSER_MODEL, ...developerBrowserFields({ url }) };
test("browser requests bind one canonical HTTPS page to a fixed session budget", () => {
  assert.equal(validDeveloperBrowserRequest(body), true);
  assert.equal(body.session_seconds, 60);
  for (const patch of [
    { session_seconds: 61 },
    { model: "arbitrary" },
    { cookies: "secret" },
    { url: "https://127.0.0.1/" },
    { url: "https://service.internal/" },
    { url: "https://www.example.com:444/" },
    { url: "https://www.example.com/?token=private" },
    { url: "https://user@www.example.com/" },
    { url: "https://www.example.com/#fragment" },
    { url: "http://www.example.com/" },
  ])
    assert.equal(validDeveloperBrowserRequest({ ...body, ...patch }), false);
});
test("operator allowlists must contain distinct canonical origins", () => {
  assert.deepEqual(developerBrowserOrigins('["https://www.example.com"]'), [
    "https://www.example.com",
  ]);
  for (const raw of [
    "[]",
    '["https://www.example.com/"]',
    '["https://www.example.com/docs"]',
    '["https://www.example.com","https://www.example.com"]',
    '["https://localhost"]',
    '["https://10.0.0.1"]',
  ])
    assert.throws(() => developerBrowserOrigins(raw));
});
test("settlement requires a completed, bounded session receipt", () => {
  const receipt = {
    id: "11111111-1111-4111-8111-111111111111",
    model: BROWSER_MODEL,
    status: "completed",
    usage: { browser_sessions_60s: 1 },
  };
  assert.equal(developerBrowserReceipt(receipt), true);
  for (const patch of [
    { id: "missing" },
    { status: "failed" },
    { model: "other" },
    { usage: {} },
    { usage: { browser_sessions_60s: 2 } },
  ])
    assert.equal(developerBrowserReceipt({ ...receipt, ...patch }), false);
});

test("browser plan binds distinct same-origin targets and rejects changes outside the approved origin", async () => {
  const { developerBrowserTargets, executeDeveloperBrowserPlan } =
    await import("../../src/lib/pricing/developer-browser-policy.mjs");
  const urls = [url, "https://www.example.com/about", "https://www.example.com/news"];
  const plan = {
    model: BROWSER_MODEL,
    ...developerBrowserFields({ url, navigate: urls.slice(1) }),
  };
  assert.equal(validDeveloperBrowserRequest(plan), true);
  assert.deepEqual(
    developerBrowserTargets(plan).map((x) => x.href),
    urls,
  );
  for (const navigate of [
    [],
    [url],
    [urls[1], urls[1]],
    ["https://other.com/"],
    ["https://www.example.com/?secret=x"],
    [...urls, urls[1]],
    null,
  ]) {
    assert.equal(validDeveloperBrowserRequest({ ...plan, navigate }), false);
  }
  const calls = [];
  const check = async (target) => calls.push("check:" + target.href);
  const capture = async (target) => {
    calls.push("capture:" + target.href);
    return { url: target.href, text: "data" };
  };
  const result = await executeDeveloperBrowserPlan(plan, { check, capture });
  assert.deepEqual(
    result.map((x) => x.url),
    urls,
  );
  assert.deepEqual(
    calls,
    urls.flatMap((x) => ["check:" + x, "capture:" + x, "check:" + x]),
  );
  const cancel = new AbortController();
  let count = 0;
  await assert.rejects(
    executeDeveloperBrowserPlan(plan, {
      check,
      capture: async (target) => {
        count++;
        cancel.abort();
        return { url: target.href, text: "data" };
      },
      signal: cancel.signal,
    }),
    /abort/i,
  );
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(
    executeDeveloperBrowserPlan(plan, {
      check: async (target) => {
        if (target.href === urls[1]) throw Error("revoked");
      },
      capture: async (target) => {
        count++;
        return { url: target.href, text: "data" };
      },
    }),
    /revoked/,
  );
  assert.equal(count, 1);
  await assert.rejects(
    executeDeveloperBrowserPlan(plan, {
      check,
      capture: async () => ({ url: "https://other.com/", text: "redirect" }),
    }),
    /browser_unavailable/,
  );
});
