import assert from "node:assert/strict";
import test from "node:test";
import { passkeyFixture } from "../helpers/kova-passkey-fixture.mjs";
import {
  kovaPasskeyRegistrationOptions,
  kovaPasskeyAuthenticationOptions,
  kovaPasskeyRp,
  verifyKovaPasskeyRegistration,
  verifyKovaPasskeyAuthentication,
} from "../../src/lib/kova-auth-passkey-crypto.server.mjs";

const expected = { challenge: "c".repeat(43), origin: "https://kova.test", rpID: "kova.test" };
const fixture = passkeyFixture();

test("owned WebAuthn uses discoverable credentials, required UV, fixed RP, and random 256-bit challenges", async () => {
  const a = await kovaPasskeyRegistrationOptions({
    accountId: "10000000-0000-4000-8000-000000000001",
    email: "owner@example.invalid",
    origin: expected.origin,
    credentialIds: [fixture.key.credentialId],
  });
  const b = await kovaPasskeyAuthenticationOptions(expected.origin);
  assert.equal(a.authenticatorSelection.residentKey, "required");
  assert.equal(a.authenticatorSelection.userVerification, "required");
  assert.equal(a.attestation, "none");
  assert.deepEqual(
    a.pubKeyCredParams.map((item) => item.alg),
    [-7, -257, -8],
  );
  assert.equal(a.excludeCredentials[0].id, fixture.key.credentialId);
  assert.equal(Buffer.from(a.challenge, "base64url").length, 32);
  assert.notEqual(a.challenge, b.challenge);
  assert.equal(b.userVerification, "required");
  assert.deepEqual(b.allowCredentials, []);
  assert.equal(b.rpId, "kova.test");
});

test("real WebAuthn registration and ECDSA login signatures verify without external services", async () => {
  const registered = await verifyKovaPasskeyRegistration(
    fixture.registration(expected.challenge),
    expected,
  );
  assert.deepEqual(registered, fixture.credential);
  const verified = await verifyKovaPasskeyAuthentication(
    fixture.authentication(expected.challenge, { counter: 1 }),
    { ...expected, key: fixture.key },
  );
  assert.deepEqual(verified, { counter: 1, backedUp: false });
});

for (const [label, options] of [
  ["wrong origin", { origin: "https://attacker.invalid" }],
  ["wrong RP", { rpID: "attacker.invalid" }],
  ["missing UV", { flags: 0x41 }],
  ["missing UP", { flags: 0x44 }],
  ["embedded origin", { client: { crossOrigin: true } }],
  ["untrusted top origin", { client: { topOrigin: "https://attacker.invalid" } }],
  ["invalid cross-origin type", { client: { crossOrigin: "false" } }],
  ["incorrect ceremony", { client: { type: "webauthn.get" } }],
])
  test(`registration rejects ${label}`, async () => {
    await assert.rejects(
      verifyKovaPasskeyRegistration(fixture.registration(expected.challenge, options), expected),
    );
  });

for (const [label, options] of [
  ["wrong origin", { origin: "https://attacker.invalid" }],
  ["wrong RP", { rpID: "attacker.invalid" }],
  ["missing UV", { flags: 0x01 }],
  ["missing UP", { flags: 0x04 }],
  ["embedded origin", { client: { crossOrigin: true } }],
  ["untrusted top origin", { client: { topOrigin: "https://attacker.invalid" } }],
  ["changed backup eligibility", { flags: 0x1d }],
  ["incorrect ceremony", { client: { type: "webauthn.create" } }],
])
  test(`authentication rejects ${label} even with a real signature`, async () => {
    await assert.rejects(
      verifyKovaPasskeyAuthentication(fixture.authentication(expected.challenge, options), {
        ...expected,
        key: fixture.key,
      }),
    );
  });

test("wrong challenge, modified signature, wrong key, and mismatched handles never authenticate", async () => {
  await assert.rejects(
    verifyKovaPasskeyRegistration(fixture.registration("d".repeat(43)), expected),
  );
  await assert.rejects(
    verifyKovaPasskeyAuthentication(fixture.authentication("d".repeat(43)), {
      ...expected,
      key: fixture.key,
    }),
  );
  const response = fixture.authentication(expected.challenge);
  const bad = Buffer.from(response.response.signature, "base64url");
  bad[bad.length - 1] ^= 1;
  await assert.rejects(
    verifyKovaPasskeyAuthentication(
      { ...response, response: { ...response.response, signature: bad.toString("base64url") } },
      { ...expected, key: fixture.key },
    ),
  );
  await assert.rejects(
    verifyKovaPasskeyAuthentication(response, {
      ...expected,
      key: { ...fixture.key, publicKeyHex: passkeyFixture().key.publicKeyHex },
    }),
  );
  await assert.rejects(
    verifyKovaPasskeyAuthentication(
      { ...response, response: { ...response.response, userHandle: "other" } },
      { ...expected, key: fixture.key },
    ),
  );
  await assert.rejects(
    verifyKovaPasskeyAuthentication(
      { ...response, rawId: "different" },
      { ...expected, key: fixture.key },
    ),
  );
});

test("counter regressions fail but authentic zero-counter synced passkeys remain usable", async () => {
  for (const count of [0, 3, 5])
    await assert.rejects(
      verifyKovaPasskeyAuthentication(
        fixture.authentication(expected.challenge, { counter: count }),
        { ...expected, key: { ...fixture.key, counter: 5 } },
      ),
    );
  const synced = passkeyFixture({ backupEligible: true });
  assert.equal(
    (await verifyKovaPasskeyRegistration(synced.registration(expected.challenge), expected))
      .backupEligible,
    true,
  );
  assert.deepEqual(
    await verifyKovaPasskeyAuthentication(synced.authentication(expected.challenge), {
      ...expected,
      key: synced.key,
    }),
    { counter: 0, backedUp: true },
  );
});

test("malformed encodings, unbounded data, and unsafe RP configuration are rejected", async () => {
  const response = fixture.registration(expected.challenge);
  for (const data of ["=invalid", "A".repeat(20_000), Buffer.from([0xff]).toString("base64url")]) {
    await assert.rejects(
      verifyKovaPasskeyRegistration(
        { ...response, response: { ...response.response, clientDataJSON: data } },
        expected,
      ),
    );
  }
  for (const origin of [
    "http://kova.test",
    "https://kova.test/",
    "https://name:password@kova.test",
    "https://kova.test/path",
    "https://[::1]",
  ]) {
    assert.throws(() => kovaPasskeyRp(origin));
  }
});