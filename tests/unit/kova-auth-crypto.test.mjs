import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
} from "node:crypto";
import test from "node:test";
import {
  decryptKovaSecret,
  digestKovaToken,
  encryptKovaSecret,
  generateKovaToken,
  generateKovaTotpEnrollment,
  hashKovaPassword,
  kovaPasswordHashNeedsUpgrade,
  kovaPasswordHashWriteAlgorithm,
  KovaPasswordInfrastructureError,
  normalizeKovaEmail,
  rehashKovaPassword,
  signKovaCompatibilityJwt,
  verifyGoogleIdToken,
  verifyKovaPassword,
  verifyKovaTotp,
} from "../../src/lib/kova-auth-crypto.server.mjs";

function encodedJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

const ARGON_WRITES = { KOVA_AUTH_PASSWORD_HASH_WRITE: "argon2id" };

function legacyPasswordHash(password) {
  const salt = Buffer.from("kova-test-salt16", "utf8");
  const digest = scryptSync(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt-v1$32768$8$1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

test("password verification enforces the UTF-8 maximum without imposing the new-password minimum", async () => {
  const legacyPassword = "legacy";
  const legacyHash = legacyPasswordHash(legacyPassword);
  assert.equal(await verifyKovaPassword(legacyPassword, legacyHash), true);
  assert.equal(await verifyKovaPassword("wrong", legacyHash), false);
  await assert.rejects(() => hashKovaPassword(legacyPassword), /12 or more/u);

  const atLimit = "\u{1f600}".repeat(256);
  assert.equal(Buffer.byteLength(atLimit, "utf8"), 1024);
  const atLimitHash = await hashKovaPassword(atLimit, ARGON_WRITES);
  assert.equal(await verifyKovaPassword(atLimit, atLimitHash), true);

  // A matching, well-formed legacy fixture makes this a regression test: the
  // previous verifier accepted these bytes despite the password writer's cap.
  const overLimit = `${atLimit}a`;
  assert.ok(overLimit.length < 1024);
  assert.equal(Buffer.byteLength(overLimit, "utf8"), 1025);
  const overLimitHash = legacyPasswordHash(overLimit);
  assert.equal(await verifyKovaPassword(overLimit, overLimitHash), false);
  await assert.rejects(() => hashKovaPassword(overLimit), /1024 UTF-8 bytes/u);
});

test("password verification rejects oversized ASCII and malformed input", async () => {
  const oversized = "a".repeat(1025);
  assert.equal(await verifyKovaPassword(oversized, legacyPasswordHash(oversized)), false);
  for (const value of [undefined, null, 1, {}, "\ud800"]) {
    assert.equal(await verifyKovaPassword(value, "invalid"), false);
  }
});

test("password writes default to legacy until Argon2id is explicitly qualified", async () => {
  assert.equal(kovaPasswordHashWriteAlgorithm({}), "scrypt-v1");
  assert.equal(
    kovaPasswordHashWriteAlgorithm({ KOVA_AUTH_PASSWORD_HASH_WRITE: "scrypt-v1" }),
    "scrypt-v1",
  );
  assert.equal(kovaPasswordHashWriteAlgorithm(ARGON_WRITES), "argon2id");
  const password = "nonsecret-password-fixture";
  const defaultHash = await hashKovaPassword(password, {});
  const explicitHash = await hashKovaPassword(password, {
    KOVA_AUTH_PASSWORD_HASH_WRITE: "scrypt-v1",
  });
  for (const encoded of [defaultHash, explicitHash]) {
    assert.match(encoded, /^scrypt-v1\$32768\$8\$1\$/u);
    assert.equal(encoded.length, 86);
    assert.equal(await verifyKovaPassword(password, encoded), true);
    assert.equal(kovaPasswordHashNeedsUpgrade(encoded), true);
  }
});

test("unknown password writer configuration fails closed with a sanitized infrastructure error", async () => {
  for (const configured of ["", "Argon2id", "argon2i", "scrypt", "unexpected-config-value"]) {
    const env = { KOVA_AUTH_PASSWORD_HASH_WRITE: configured };
    assert.throws(() => kovaPasswordHashWriteAlgorithm(env), KovaPasswordInfrastructureError);
    await assert.rejects(
      () => hashKovaPassword("nonsecret-password-fixture", env),
      (error) =>
        error instanceof KovaPasswordInfrastructureError &&
        error.code === "kova_password_infrastructure" &&
        !error.message.includes(configured || '""'),
    );
  }
});

test("opaque tokens, normalized emails, and Argon2id passwords fail closed", async () => {
  assert.equal(normalizeKovaEmail(" Owner@Example.COM "), "owner@example.com");
  assert.throws(() => normalizeKovaEmail("not-an-email"), /Invalid email/u);
  const token = generateKovaToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(digestKovaToken(token), /^[a-f0-9]{64}$/u);

  const passwordHash = await hashKovaPassword("correct horse battery staple", ARGON_WRITES);
  assert.match(passwordHash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u);
  assert.equal(await verifyKovaPassword("correct horse battery staple", passwordHash), true);
  assert.equal(await verifyKovaPassword("wrong password", passwordHash), false);
  assert.equal(await verifyKovaPassword("correct horse battery staple", `${passwordHash}x`), false);
  await assert.rejects(() => hashKovaPassword("too-short"), /12 or more/u);
});

test("Argon2id writes use independent salts and legacy rehash preserves existing password lengths", async () => {
  const password = "nonsecret-password-fixture";
  const first = await hashKovaPassword(password, ARGON_WRITES);
  const second = await hashKovaPassword(password, ARGON_WRITES);
  assert.notEqual(first, second);
  const [, algorithm, version, parameters, salt, digest] = first.split("$");
  assert.equal(algorithm, "argon2id");
  assert.equal(version, "v=19");
  assert.equal(parameters, "m=19456,p=1,t=2");
  assert.equal(Buffer.from(salt, "base64").length, 16);
  assert.equal(Buffer.from(digest, "base64").length, 32);
  assert.equal(kovaPasswordHashNeedsUpgrade(first), false);

  const shortLegacy = "legacy";
  const legacyHash = legacyPasswordHash(shortLegacy);
  assert.equal(kovaPasswordHashNeedsUpgrade(legacyHash), true);
  assert.equal(await verifyKovaPassword(shortLegacy, legacyHash), true);
  const upgraded = await rehashKovaPassword(shortLegacy);
  assert.match(upgraded, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u);
  assert.equal(await verifyKovaPassword(shortLegacy, upgraded), true);
  assert.equal(await verifyKovaPassword("wrong", upgraded), false);
  assert.equal(kovaPasswordHashNeedsUpgrade(upgraded), false);
  const alternateOrder = upgraded.replace("m=19456,p=1,t=2", "m=19456,t=2,p=1");
  assert.equal(await verifyKovaPassword(shortLegacy, alternateOrder), true);
  await assert.rejects(() => hashKovaPassword(shortLegacy), /12 or more/u);
});

test("password verification rejects unsupported costs, algorithms and noncanonical encodings before KDF", async () => {
  const password = "nonsecret-password-fixture";
  const encoded = await hashKovaPassword(password, ARGON_WRITES);
  const parts = encoded.split("$");
  const malformed = [
    encoded.replace("argon2id", "argon2i"),
    encoded.replace("v=19", "v=16"),
    encoded.replace("m=19456", "m=4294967295"),
    encoded.replace("t=2", "t=999999999"),
    encoded.replace("p=1", "p=2"),
    encoded.replace("m=19456,p=1,t=2", "t=2,m=19456,p=1"),
    encoded.replace("m=19456,p=1,t=2", "m=19456,p=1,t=2,t=2"),
    `${encoded}$extra`,
    `${encoded}=`,
    [...parts.slice(0, 4), `${parts[4].slice(0, -1)}B`, parts[5]].join("$"),
    [...parts.slice(0, 5), `${parts[5].slice(0, -1)}B`].join("$"),
    "scrypt-v1$32768$8$1$not-a-salt$not-a-digest",
  ];
  for (const invalid of malformed) {
    assert.equal(await verifyKovaPassword(password, invalid), false);
    assert.equal(kovaPasswordHashNeedsUpgrade(invalid), false);
  }
  await assert.rejects(() => rehashKovaPassword("a".repeat(1025)), /1024 UTF-8 bytes/u);
  await assert.rejects(() => rehashKovaPassword("\ud800"), /UTF-8/u);
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

test("TOTP enrollment creates a high-entropy KovaGPT authenticator URI", () => {
  const enrollment = generateKovaTotpEnrollment("Owner@Example.com");
  assert.match(enrollment.secret, /^[A-Z2-7]{32}$/u);
  assert.match(
    enrollment.uri,
    /^otpauth:\/\/totp\/KovaGPT%3Aowner%40example\.com\?secret=[A-Z2-7]{32}&issuer=KovaGPT&algorithm=SHA1&digits=6&period=30$/u,
  );
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
  assert.equal(payload.kova_auth, 1);
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
