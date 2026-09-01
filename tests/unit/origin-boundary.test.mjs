import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  enforceAzureProductionOriginBoundary,
  parseForwardedClientCertificateFingerprint,
  parseTrustedProxyCertificateFingerprints,
} from "../../src/lib/origin-boundary.server.ts";

const fingerprintA = "a1".repeat(32);
const fingerprintB = "b2".repeat(32);

const productionEnvironment = {
  AZURE_ENVIRONMENT: "production",
  KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS: fingerprintA,
};

function requestWithHash(hash) {
  return new Request("https://ca-kovagpt-prod.example/api/version", {
    headers: {
      "X-Forwarded-Client-Cert": `Hash=${hash};Cert="redacted";Chain="redacted";`,
    },
  });
}

test("trusted proxy fingerprints are strict and support a two-certificate rotation", () => {
  assert.deepEqual(
    parseTrustedProxyCertificateFingerprints(`${fingerprintA},${fingerprintB.toUpperCase()}`),
    [fingerprintA, fingerprintB],
  );
  assert.deepEqual(
    parseTrustedProxyCertificateFingerprints(fingerprintA.toUpperCase().match(/.{2}/gu).join(":")),
    [fingerprintA],
  );

  for (const invalid of [
    undefined,
    "",
    "not-a-fingerprint",
    `${fingerprintA},${fingerprintA}`,
    `${fingerprintA},${fingerprintB},${"c3".repeat(32)}`,
  ]) {
    assert.equal(parseTrustedProxyCertificateFingerprints(invalid), null);
  }
});

test("forwarded certificate parsing rejects missing, malformed, and ambiguous hashes", () => {
  assert.equal(parseForwardedClientCertificateFingerprint(null), null);
  assert.equal(parseForwardedClientCertificateFingerprint("Cert=redacted;"), null);
  assert.equal(
    parseForwardedClientCertificateFingerprint(`Hash=${fingerprintA};Hash=${fingerprintB};`),
    null,
  );
  assert.equal(
    parseForwardedClientCertificateFingerprint(
      `Hash=${fingerprintA};Cert=x;,Hash=${fingerprintB};Cert=y;`,
    ),
    null,
  );
  assert.equal(
    parseForwardedClientCertificateFingerprint(`Hash=${fingerprintA.toUpperCase()};Cert=x;`),
    fingerprintA,
  );
});

test("Azure production rejects raw-origin traffic and accepts only a pinned proxy cert", async () => {
  for (const request of [
    new Request("https://ca-kovagpt-prod.example/"),
    requestWithHash(fingerprintB),
  ]) {
    const response = enforceAzureProductionOriginBoundary(request, productionEnvironment);
    assert.equal(response?.status, 403);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.equal(await response?.text(), "Forbidden");
  }

  assert.equal(
    enforceAzureProductionOriginBoundary(requestWithHash(fingerprintA), productionEnvironment),
    null,
  );
  assert.equal(
    enforceAzureProductionOriginBoundary(new Request("http://localhost/"), {
      AZURE_ENVIRONMENT: "development",
    }),
    null,
  );
});

test("Azure production refuses to boot without a valid pinned proxy certificate", () => {
  const validator = readFileSync("src/lib/azure-runtime-env.server.ts", "utf8");
  assert.match(validator, /AZURE_ENVIRONMENT\?\.trim\(\)\.toLowerCase\(\) === "production"/u);
  assert.match(validator, /parseTrustedProxyCertificateFingerprints/u);
  assert.match(
    validator,
    /requires one or two valid Cloudflare client-certificate SHA-256 fingerprints/u,
  );

  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*node:net/u);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/u);
});
