import assert from "node:assert/strict";
import test from "node:test";
import { NodeRequest } from "srvx/node";
import { kovaAuthRequestUrl } from "../../src/lib/kova-auth-proxy-origin.mjs";
import { authHttp } from "../helpers/kova-auth-http.mjs";
const origin = "https://rehearsal.example.invalid";
const env = {
  KOVA_AUTH_PUBLIC_ORIGIN: origin,
  KOVA_AUTH_ORIGIN: origin,
  KOVA_AUTH_REVERSE_PROXY_ORIGIN: origin,
};
const request = (headers = {}, host = "rehearsal.example.invalid") =>
  new NodeRequest({
    req: {
      method: "GET",
      url: "/api/auth/google/start",
      headers: { host, "x-forwarded-proto": "https", "sec-fetch-site": "same-origin", ...headers },
      socket: { encrypted: false },
    },
  });
test("actual Nitro NodeRequest reproduces TLS-offload HTTP URL and Google 404", async () => {
  const req = request();
  assert.equal(new URL(req.url).origin, origin.replace("https:", "http:"));
  const h = authHttp({ env: { ...env, KOVA_AUTH_REVERSE_PROXY_ORIGIN: undefined } });
  assert.equal((await h.handleKovaGoogleStart(req)).status, 404);
});
test("exact opt-in reaches Google config validation instead of wrong-origin 404", async () => {
  const h = authHttp({ env });
  assert.equal(kovaAuthRequestUrl(request(), env).origin, origin);
  const response = await h.handleKovaGoogleStart(request());
  assert.equal(response.status, 503);
  assert.equal(h.calls.length, 0);
});
test("foreign hosts, ambiguous forwarding, HTTP forwarding and unconfigured trust stay rejected", () => {
  for (const [req, settings] of [
    [request({}, "evil.invalid"), env],
    [request({ "x-forwarded-proto": "https,http" }), env],
    [request({ "x-forwarded-proto": "http" }), env],
    [request({ "x-forwarded-host": "evil.invalid" }), env],
    [request(), { ...env, KOVA_AUTH_REVERSE_PROXY_ORIGIN: "https://other.invalid" }],
    [request(), { ...env, KOVA_AUTH_REVERSE_PROXY_ORIGIN: undefined }],
  ])
    assert.notEqual(kovaAuthRequestUrl(req, settings).origin, origin);
});
test("proxy normalization does not weaken Google browser origin or state checks", async () => {
  const h = authHttp({ env });
  assert.equal(
    (await h.handleKovaGoogleStart(request({ "sec-fetch-site": "cross-site" }))).status,
    403,
  );
  assert.equal(
    (await h.handleKovaGoogleStart(request({ origin: "https://evil.invalid" }))).status,
    403,
  );
  const callback = new Request(
    "http://rehearsal.example.invalid/api/auth/google/callback?code=x&state=y",
    { headers: { "x-forwarded-proto": "https" } },
  );
  const configured = authHttp({
    env: { ...env, KOVA_GOOGLE_CLIENT_ID: "fixture", KOVA_GOOGLE_CLIENT_SECRET: "fixture" },
  });
  const response = await configured.handleKovaGoogleCallback(callback);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /google_invalid_state/);
  assert.equal(configured.calls.length, 0);
});
