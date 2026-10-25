import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parseAzureDirectPublicOrigin } from "../../src/lib/azure-direct-origin.server.mjs";
import {
  enforceAzureProductionOriginBoundary,
  normalizeAzureProductionRequest,
  parseTrustedProxyCertificateFingerprints,
} from "../../src/lib/origin-boundary.server.ts";
import { resolveAnonymousClientKey } from "../../src/lib/chat-ingress.server.mjs";

const origin = "https://kovagpt-prod-web.fixture.eastus.azurecontainerapps.io";
const env = {
  AZURE_ENVIRONMENT: "production",
  KOVA_PRODUCTION_ORIGIN_MODE: "azure-direct",
  CONTAINER_APP_NAME: "kovagpt-prod-web",
  KOVA_AZURE_PUBLIC_ORIGIN: origin,
};
function request(path = "/api/health", headers = {}, options = {}) {
  return new Request(`${origin}${path}`, {
    ...options,
    headers: { "x-forwarded-proto": "https", ...headers },
  });
}

test("direct Azure configuration requires the exact HTTPS origin of the configured app", () => {
  assert.equal(parseAzureDirectPublicOrigin(env), origin);
  for (const value of [
    "http://kovagpt-prod-web.fixture.eastus.azurecontainerapps.io",
    `${origin}/`,
    `${origin}/login`,
    `${origin}?next=evil`,
    `${origin}#fragment`,
    "https://kovagpt-prod-web.fixture.eastus.azurecontainerapps.io:443",
    "https://user:password@kovagpt-prod-web.fixture.eastus.azurecontainerapps.io",
    "https://other-app.fixture.eastus.azurecontainerapps.io",
    "https://kovagpt-prod-web.fixture.eastus.azurecontainerapps.io.attacker.test",
    "https://kovagpt-prod-web.attacker.test",
    "https://kovagpt-prod-web.azurecontainerapps.io",
    undefined,
  ]) {
    assert.equal(parseAzureDirectPublicOrigin({ ...env, KOVA_AZURE_PUBLIC_ORIGIN: value }), null);
  }
  assert.equal(parseAzureDirectPublicOrigin({ ...env, CONTAINER_APP_NAME: undefined }), null);
});

test("explicit direct mode accepts Azure HTTPS ingress for every route without a fake certificate", () => {
  for (const path of [
    "/",
    "/api/health",
    "/api/chat",
    "/api/ai/services",
    "/api/voice",
    "/api/speech",
    "/api/auth/session",
    "/api/openai/webhook",
  ])
    assert.equal(enforceAzureProductionOriginBoundary(request(path), env), null);
});

test("direct mode rejects missing or ambiguous Azure protocol, foreign authorities and forwarding spoofing", () => {
  for (const invalid of [
    new Request(`${origin}/api/chat`),
    request("/api/chat", { "x-forwarded-proto": "http" }),
    request("/api/chat", { "x-forwarded-proto": "https,http" }),
    request("/api/chat", { host: "attacker.test" }),
    request("/api/chat", { "x-forwarded-host": "attacker.test" }),
    request("/api/chat", { "x-forwarded-host": `${new URL(origin).host},attacker.test` }),
    new Request("https://attacker.test/api/chat", { headers: { "x-forwarded-proto": "https" } }),
    new Request("http://localhost:3000/api/health"),
  ]) {
    const result = enforceAzureProductionOriginBoundary(invalid, env);
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(
    enforceAzureProductionOriginBoundary(
      request("/api/chat", {
        "x-forwarded-proto": "http",
        "x-forwarded-client-cert": `Hash=${"ab".repeat(32)}`,
      }),
      { ...env, KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS: "ab".repeat(32) },
    ).status,
    403,
  );
});

test("normalization restores the public HTTPS URL and retains request content and cancellation", async () => {
  const controller = new AbortController();
  const incoming = new Request(`${origin.replace("https:", "http:")}/api/ai/services?mode=1`, {
    method: "POST",
    headers: {
      "x-forwarded-proto": "https",
      origin,
      "content-type": "application/json",
      authorization: "Bearer fixture",
    },
    body: JSON.stringify({ operation: "moderation", input: "fixture" }),
    signal: controller.signal,
  });
  assert.equal(enforceAzureProductionOriginBoundary(incoming, env), null);
  const normalized = normalizeAzureProductionRequest(incoming, env);
  assert.equal(normalized.url, `${origin}/api/ai/services?mode=1`);
  assert.equal(normalized.headers.get("authorization"), "Bearer fixture");
  assert.equal(normalized.headers.get("origin"), origin);
  assert.equal(normalized.method, "POST");
  assert.deepEqual(await normalized.json(), { operation: "moderation", input: "fixture" });
  controller.abort();
  assert.equal(normalized.signal.aborted, true);
  assert.throws(
    () => normalizeAzureProductionRequest(new Request("https://attacker.test/"), env),
    /origin_rejected/,
  );
});

test("direct mutations require the exact Origin even when a foreign Azure app claims same-site", () => {
  const foreignOrigin = "https://other-app.fixture.eastus.azurecontainerapps.io";
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const suppliedOrigin of [
      foreignOrigin,
      "https://attacker.test",
      "null",
      "",
      `${origin}, ${origin}`,
    ]) {
      const incoming = request(
        "/api/auth/session",
        { origin: suppliedOrigin, "sec-fetch-site": "same-site" },
        { method },
      );
      const result = enforceAzureProductionOriginBoundary(incoming, env);
      assert.equal(result.status, 403);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.throws(() => normalizeAzureProductionRequest(incoming, env), /origin_rejected/);
    }
    assert.equal(
      enforceAzureProductionOriginBoundary(
        request("/api/auth/session", { origin, "sec-fetch-site": "same-site" }, { method }),
        env,
      ),
      null,
    );
  }
});

test("originless signed-server callbacks reach the existing webhook verification handler", () => {
  const callback = request(
    "/api/openai/webhook",
    {
      "webhook-id": "fixture-event",
      "webhook-timestamp": "1234567890",
      "webhook-signature": "fixture-signature",
    },
    { method: "POST", body: '{"type":"response.completed"}' },
  );
  assert.equal(callback.headers.has("origin"), false);
  assert.equal(enforceAzureProductionOriginBoundary(callback, env), null);
  const normalized = normalizeAzureProductionRequest(callback, env);
  assert.equal(normalized.headers.get("webhook-signature"), "fixture-signature");
  assert.equal(normalized.url, `${origin}/api/openai/webhook`);
});

test("the Cloudflare default boundary remains pinned and a new mode cannot silently bypass it", () => {
  const pin = "ab".repeat(32);
  const legacy = {
    AZURE_ENVIRONMENT: "production",
    KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS: pin,
  };
  assert.equal(enforceAzureProductionOriginBoundary(request(), legacy).status, 403);
  assert.equal(
    enforceAzureProductionOriginBoundary(
      request("/", { "x-forwarded-client-cert": `Hash=${pin}` }),
      legacy,
    ),
    null,
  );
  assert.equal(
    enforceAzureProductionOriginBoundary(request(), { ...env, KOVA_PRODUCTION_ORIGIN_MODE: "typo" })
      .status,
    403,
  );
  assert.equal(
    enforceAzureProductionOriginBoundary(request(), { ...env, KOVA_AZURE_PUBLIC_ORIGIN: undefined })
      .status,
    403,
  );
  const incoming = request();
  assert.equal(normalizeAzureProductionRequest(incoming, legacy), incoming);
});

test("Azure anonymous limits use only its appended rightmost IP and ignore client CF headers", () => {
  for (const spoof of ["192.0.2.99", "2001:db8::9"]) {
    const headers = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-for": `${spoof}, 198.51.100.7`,
      "cf-connecting-ip": spoof,
    });
    assert.equal(resolveAnonymousClientKey(headers, env), "ip:198.51.100.7");
  }
  assert.equal(
    resolveAnonymousClientKey(
      new Headers({ "x-forwarded-proto": "https", "x-forwarded-for": "192.0.2.1, 2001:db8::1" }),
      env,
    ),
    "ip:2001:db8::1",
  );
  for (const headers of [
    { "cf-connecting-ip": "192.0.2.1" },
    { "x-forwarded-proto": "http", "x-forwarded-for": "198.51.100.7" },
    {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "198.51.100.7, invalid",
      "cf-connecting-ip": "192.0.2.1",
    },
    { "x-forwarded-proto": "https", "x-forwarded-for": `${"1".repeat(2048)},198.51.100.7` },
  ])
    assert.equal(resolveAnonymousClientKey(new Headers(headers), env), "ip:unknown");
  assert.equal(
    resolveAnonymousClientKey(
      new Headers({ "cf-connecting-ip": "192.0.2.2", "x-forwarded-for": "198.51.100.7" }),
      { AZURE_ENVIRONMENT: "production" },
    ),
    "ip:192.0.2.2",
  );
});

test("production startup validates the selected origin mode before accepting runtime credentials", () => {
  const output = ts.transpileModule(
    fs.readFileSync("src/lib/azure-runtime-env.server.ts", "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const exports = {};
  new Function("exports", "require", output)(exports, () => ({
    parseAzureDirectPublicOrigin,
    parseTrustedProxyCertificateFingerprints,
  }));
  const validate = exports.validateAzureRuntimeEnv;
  assert.doesNotThrow(() => validate(env));
  assert.throws(
    () => validate({ ...env, KOVA_AZURE_PUBLIC_ORIGIN: "https://attacker.test" }),
    /exact HTTPS app origin/,
  );
  assert.throws(
    () => validate({ ...env, KOVA_PRODUCTION_ORIGIN_MODE: "private-typo" }),
    (error) => /origin mode/.test(error.message) && !error.message.includes("private-typo"),
  );
  assert.throws(
    () => validate({ AZURE_ENVIRONMENT: "production" }),
    /Cloudflare client-certificate/,
  );
  assert.doesNotThrow(() =>
    validate({
      AZURE_ENVIRONMENT: "production",
      KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS: "ab".repeat(32),
    }),
  );
});
