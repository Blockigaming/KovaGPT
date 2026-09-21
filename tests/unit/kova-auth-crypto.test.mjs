import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import test from "node:test";
import {
  decryptKovaSecret,
  digestKovaToken,
  encryptKovaSecret,
  generateKovaToken,
  hashKovaPassword,
  normalizeKovaEmail,
  signKovaCompatibilityJwt,
  verifyGoogleIdToken,
  verifyKovaPassword,
  verifyKovaTotp,
} from "../../src/lib/kova-auth-crypto.server.mjs";

function encodedJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("opaque tokens, normalized emails, and scrypt passwords fail closed", async () => {
  assert.equal(normalizeKovaEmail(" Owner@Example.COM "), "owner@example.com");
  assert.throws(() => normalizeKovaEmail("not-an-email"), /Invalid email/u);
  const token = generateKovaToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(digestKovaToken(token), /^[a-f0-9]{64}$/u);

  const passwordHash = await hashKovaPassword("correct horse battery staple");
  assert.match(passwordHash, /^scrypt-v1\$32768\$8\$1\$/u);
  assert.equal(await verifyKovaPassword("correct horse battery staple", passwordHash), true);
  assert.equal(await verifyKovaPassword("wrong password", passwordHash), false);
  assert.equal(await verifyKovaPassword("correct horse battery staple", `${passwordHash}x`), false);
  await assert.rejects(() => hashKovaPassword("too-short"), /12 or more/u);
});

test("TOTP verification accepts the current RFC 6238 code and a narrow clock window", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyKovaTotp("287082", secret, 59_000), true);
  assert.equal(verifyKovaTotp("287082", secret, 89_000), true);
  assert.equal(verifyKovaTotp("287082", secret, 119_000), false);
  assert.equal(verifyKovaTotp("000000", secret, 59_000), false);
  assert.equal(verifyKovaTotp("28708", secret, 59_000), false);
  assert.equal(verifyKovaTotp("287082", "not-base32", 59_000), false);
});

test("OAuth secret encryption pins its key and authenticates ciphertext", () => {
  const key = randomBytes(32);
  const env = {
    KOVA_AUTH_ENCRYPTION_KEY: key.toString("base64url"),
    KOVA_AUTH_ENCRYPTION_KEY_SHA256: createHash("sha256").update(key).digest("hex"),
  };
  const encrypted = encryptKovaSecret("pkce-verifier-secret", env);
  assert.notEqual(encrypted, "pkce-verifier-secret");
  assert.equal(decryptKovaSecret(encrypted, env), "pkce-verifier-secret");
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => decryptKovaSecret(tampered, env),
    /authenticate data|Invalid encrypted secret/u,
  );
  assert.throws(
    () => encryptKovaSecret("secret", { ...env, KOVA_AUTH_ENCRYPTION_KEY_SHA256: "0".repeat(64) }),
    /fingerprint mismatch/u,
  );
});

test("compatibility JWTs are ES256, short-lived, and stable-UUID bound", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const env = {
    KOVA_AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    KOVA_AUTH_JWT_KEY_ID: "staging-kova-1",
    KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: createHash("sha256").update(publicDer).digest("hex"),
    KOVA_AUTH_ISSUER: "https://auth.staging.kovagpt.com/",
  };
  const now = Date.parse("2026-09-20T20:00:00Z");
  const jwt = signKovaCompatibilityJwt(
    {
      accountId: "10000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000002",
      email: "owner@example.com",
      emailVerified: true,
      assuranceLevel: "aal1",
    },
    env,
    now,
  );
  const [headerText, payloadText, signatureText] = jwt.split(".");
  const header = JSON.parse(Buffer.from(headerText, "base64url"));
  const payload = JSON.parse(Buffer.from(payloadText, "base64url"));
  assert.deepEqual(header, { alg: "ES256", typ: "JWT", kid: "staging-kova-1" });
  assert.equal(payload.sub, "10000000-0000-4000-8000-000000000001");
  assert.equal(payload.role, "authenticated");
  assert.equal(payload.exp - payload.iat, 300);
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${headerText}.${payloadText}`, "ascii"),
      {
        key: publicKey,
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signatureText, "base64url"),
    ),
    true,
  );
});

test("Google ID tokens require a valid RS256 signature, audience, nonce, and verified email", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "google-test-key";
  const nonce = generateKovaToken();
  const now = Date.parse("2026-09-20T20:00:00Z");
  const nowSeconds = Math.floor(now / 1000);
  const headerText = encodedJson({ alg: "RS256", kid, typ: "JWT" });
  const payloadText = encodedJson({
    iss: "https://accounts.google.com",
    aud: "kova-google-client",
    sub: "google-subject-1",
    email: "Owner@Example.com",
    email_verified: true,
    name: "Kova Owner",
    nonce,
    iat: nowSeconds - 10,
    exp: nowSeconds + 300,
  });
  const signingInput = `${headerText}.${payloadText}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey);
  const token = `${signingInput}.${signature.toString("base64url")}`;
  const jwk = publicKey.export({ format: "jwk" });
  const fetchImpl = async () =>
    new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  const identity = await verifyGoogleIdToken(token, {
    clientId: "kova-google-client",
    expectedNonceDigest: createHash("sha256").update(nonce, "utf8").digest("hex"),
    fetchImpl,
    now,
  });
  assert.deepEqual(identity, {
    subject: "google-subject-1",
    email: "owner@example.com",
    emailVerified: true,
    displayName: "Kova Owner",
  });
  await assert.rejects(
    () =>
      verifyGoogleIdToken(token, {
        clientId: "wrong-client",
        expectedNonceDigest: createHash("sha256").update(nonce, "utf8").digest("hex"),
        fetchImpl,
        now,
      }),
    /claims are invalid/u,
  );
  assert.equal(createPublicKey({ key: jwk, format: "jwk" }).asymmetricKeyType, "rsa");
});
