import assert from "node:assert/strict";
import test from "node:test";
import { loopbackPreviewHeaders } from "../helpers/loopback-preview-headers.mjs";

const headers = Object.freeze({
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'nonce-example'; upgrade-insecure-requests; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
});

test("only the HTTP loopback preview omits HTTPS upgrades while retaining other security directives", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const result = loopbackPreviewHeaders(`http://${host}:4189/`, headers);
    assert.equal(
      result["content-security-policy"],
      "default-src 'self';script-src 'self' 'nonce-example';frame-ancestors 'none'",
    );
    assert.equal(result["strict-transport-security"], headers["strict-transport-security"]);
    assert.equal(result["x-content-type-options"], "nosniff");
  }
  assert.match(headers["content-security-policy"], /upgrade-insecure-requests/);
});

test("HTTPS and non-loopback origins keep the complete production policy", () => {
  for (const url of [
    "https://127.0.0.1:4189/",
    "https://kovagpt.com/",
    "http://kovagpt.com/",
    "http://localhost.example/",
    "http://127.0.0.1.example/",
  ])
    assert.equal(loopbackPreviewHeaders(url, headers), headers);
  assert.deepEqual(loopbackPreviewHeaders("http://127.0.0.1:4189/", { "x-test": "unchanged" }), {
    "x-test": "unchanged",
  });
});

test("merged CSP headers retain both independent policies without either HTTPS upgrade", () => {
  const headers = {
    "content-security-policy":
      "default-src 'self'; upgrade-insecure-requests, script-src 'self' https://cdn.plaid.com; upgrade-insecure-requests",
  };
  const result = loopbackPreviewHeaders("http://127.0.0.1:4189/", headers);
  assert.equal(
    result["content-security-policy"],
    "default-src 'self',script-src 'self' https://cdn.plaid.com",
  );
  assert.match(headers["content-security-policy"], /upgrade-insecure-requests/);
});
