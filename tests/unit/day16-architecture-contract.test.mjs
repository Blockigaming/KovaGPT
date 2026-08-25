import assert from "node:assert/strict";
import test from "node:test";
import { auditArchitecture } from "../../scripts/release/architecture-contract.mjs";
import { normalizeCidrs, validateDnsRecord } from "../../scripts/cloudflare/verify-edge-only.mjs";

test("final architecture is Azure runtime plus Cloudflare edge only", () => {
  const result = auditArchitecture();
  assert.deepEqual(result.errors, []);
  assert.equal(result.runtime, "azure-container-apps");
  assert.equal(result.edge, "cloudflare-only");
});

test("Cloudflare edge verifier requires a proxied CNAME to the Azure origin", () => {
  validateDnsRecord(
    {
      name: "kovagpt.com",
      type: "CNAME",
      proxied: true,
      content: "kovagpt-prod.azurecontainerapps.io",
    },
    { hostname: "kovagpt.com", origin: "kovagpt-prod.azurecontainerapps.io" },
  );
  assert.throws(() =>
    validateDnsRecord(
      {
        name: "kovagpt.com",
        type: "CNAME",
        proxied: false,
        content: "kovagpt-prod.azurecontainerapps.io",
      },
      { hostname: "kovagpt.com", origin: "kovagpt-prod.azurecontainerapps.io" },
    ),
  );
});

test("Cloudflare CIDR normalization rejects duplicates", () => {
  assert.throws(() => normalizeCidrs({ ipv4_cidrs: Array(10).fill("1.1.1.0/24"), ipv6_cidrs: [] }));
});
