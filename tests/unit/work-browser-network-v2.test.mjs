import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRequestRemainsSafe,
  isPrivateAddress,
  parseAllowedHttpsUrl,
  resolvePinnedPublicUrl,
} from "../../browser-worker/src/network-safety.mjs";

for (const address of [
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "224.0.0.1",
  "::",
  "::1",
  "fc00::1",
  "fd00::1",
  "fe80::1",
  "ff00::1",
  "2001:db8::1",
  "::ffff:127.0.0.1",
]) {
  test(`private or reserved address is rejected: ${address}`, () => {
    assert.equal(isPrivateAddress(address), true);
  });
}

for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
  test(`public address is accepted: ${address}`, () => {
    assert.equal(isPrivateAddress(address), false);
  });
}

for (const value of [
  "http://example.com/",
  "https://user:pass@example.com/",
  "https://example.com:8443/",
  "https://127.0.0.1/",
  "https://localhost/",
  "https://internal.local/",
  "file:///etc/passwd",
  "not a URL",
]) {
  test(`unsafe browser source is rejected: ${value}`, () => {
    assert.throws(() => parseAllowedHttpsUrl(value, ["example.com"]));
  });
}

test("only exact owner-approved HTTPS hosts are accepted", () => {
  assert.equal(
    parseAllowedHttpsUrl("https://example.com/report?q=1#section", ["example.com"]).href,
    "https://example.com/report?q=1",
  );
  assert.throws(() =>
    parseAllowedHttpsUrl("https://sub.example.com/report", ["example.com"]),
  );
  assert.throws(() =>
    parseAllowedHttpsUrl("https://example.com.attacker.test/report", ["example.com"]),
  );
});

test("all DNS answers must be public before a target is pinned", async () => {
  await assert.rejects(
    resolvePinnedPublicUrl("https://example.com/", ["example.com"], async () => [
      { address: "203.0.113.20", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /browser_dns_private_or_invalid/u,
  );
});

test("a public target is pinned to a concrete address", async () => {
  const target = await resolvePinnedPublicUrl(
    "https://example.com/report",
    ["example.com"],
    async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ],
  );
  assert.equal(target.hostname, "example.com");
  assert.equal(target.pinnedAddress, "93.184.216.34");
});

test("redirects remain on the exact host and retain the pinned DNS answer", async () => {
  const target = await resolvePinnedPublicUrl(
    "https://example.com/start",
    ["example.com"],
    async () => [{ address: "93.184.216.34", family: 4 }],
  );
  const safe = await assertRequestRemainsSafe(
    "https://example.com/final",
    target,
    async () => [{ address: "93.184.216.34", family: 4 }],
  );
  assert.equal(safe.pathname, "/final");
  await assert.rejects(
    assertRequestRemainsSafe(
      "https://example.com/final",
      target,
      async () => [{ address: "93.184.216.35", family: 4 }],
    ),
    /browser_dns_binding_changed/u,
  );
  await assert.rejects(
    assertRequestRemainsSafe(
      "https://attacker.test/final",
      target,
      async () => [{ address: "93.184.216.34", family: 4 }],
    ),
    /browser_url_not_allowlisted/u,
  );
});
