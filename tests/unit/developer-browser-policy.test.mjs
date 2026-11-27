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
