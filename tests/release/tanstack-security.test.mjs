import test from "node:test";
import assert from "node:assert/strict";
import { requestHandler } from "@tanstack/start-server-core/request-response";
import { isSsrResponse, normalizeSsrResponse } from "@tanstack/router-core/ssr/server";

// Exercise the installed transport, rather than matching its source text. No
// network server or provider credentials are involved in these request fixtures.
const untrustedHtml = "<html><body>untrusted-response-marker</body></html>";
const responseShapedValue = () => ({
  status: 200,
  headers: { "content-type": "text/html" },
  body: untrustedHtml,
});
const request = () => new Request("https://kova.test/_serverFn/security-fixture");

for (const [name, handler] of [
  ["returned", () => responseShapedValue()],
  ["resolved", async () => responseShapedValue()],
  [
    "thrown",
    () => {
      throw responseShapedValue();
    },
  ],
  [
    "rejected",
    async () => {
      throw responseShapedValue();
    },
  ],
]) {
  test(`TanStack rejects a ${name} response-shaped object at the HTTP boundary`, async () => {
    const response = await requestHandler(handler)(request());
    assert.ok(response instanceof Response);
    assert.equal(response.status, 500);
    assert.doesNotMatch(response.headers.get("content-type") ?? "", /text\/html/i);
    assert.equal(await response.text(), "Internal Server Error");
  });
}

for (const [name, handler] of [
  ["returned", (response) => () => response],
  ["resolved", (response) => async () => response],
  [
    "thrown",
    (response) => () => {
      throw response;
    },
  ],
  [
    "rejected",
    (response) => async () => {
      throw response;
    },
  ],
]) {
  test(`TanStack preserves a legitimate ${name} Response`, async () => {
    const expected = new Response("accepted-response", {
      status: 201,
      headers: { "content-type": "text/plain", "x-kova-fixture": "accepted" },
    });
    const response = await requestHandler(handler(expected))(request());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("content-type"), "text/plain");
    assert.equal(response.headers.get("x-kova-fixture"), "accepted");
    assert.equal(await response.text(), "accepted-response");
  });
}

test("TanStack SSR rejects a response-shaped wrapper and preserves a real Response", () => {
  const forged = { response: responseShapedValue(), serverSsrCleanup: "none" };
  assert.equal(isSsrResponse(forged), false);
  assert.throws(() => normalizeSsrResponse(forged), TypeError);

  const response = new Response("accepted-SSR-response");
  const normalized = normalizeSsrResponse(response);
  assert.equal(normalized.response, response);
  assert.equal(normalized.serverSsrCleanup, "none");
  assert.equal(isSsrResponse(normalized), true);
});
