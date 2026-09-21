import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  scrypt as scryptCallback,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const HEX_256_PATTERN = /^[a-f0-9]{64}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function assertWellFormed(value, label) {
  if (typeof value !== "string" || !value.isWellFormed()) {
    throw new TypeError(`${label} must be safely encodable as UTF-8`);
  }
}

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new TypeError(`Invalid ${label}`);
  }
  return decoded;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value, label) {
  try {
    return JSON.parse(decodeBase64Url(value, label).toString("utf8"));
  } catch {
    throw new TypeError(`Invalid ${label}`);
  }
}

export function normalizeKovaEmail(value) {
  assertWellFormed(value, "Email");
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new TypeError("Invalid email address");
  }
  return email;
}

export function generateKovaToken(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 32 || bytes > 96) {
    throw new RangeError("Token entropy must be between 256 and 768 bits");
  }
  return randomBytes(bytes).toString("base64url");
}

export function digestKovaToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new TypeError("Invalid opaque token");
  }
  return createHash("sha256").update(token, "ascii").digest("hex");
}

export function digestMatches(value, expectedHex) {
  if (typeof expectedHex !== "string" || !HEX_256_PATTERN.test(expectedHex)) return false;
  let actual;
  try {
    assertWellFormed(value, "Value");
    actual = createHash("sha256").update(value, "utf8").digest();
  } catch {
    return false;
  }
  return timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
}

function decodeBase32(value) {
  if (typeof value !== "string") throw new TypeError("Invalid TOTP secret");
  const normalized = value.trim().replaceAll(" ", "").replace(/=+$/u, "").toUpperCase();
  if (normalized.length < 16 || !/^[A-Z2-7]+$/u.test(normalized)) {
    throw new TypeError("Invalid TOTP secret");
  }
  let bits = 0;
  let accumulator = 0;
  const bytes = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function encodeBase32(value) {
  let bits = 0;
  let accumulator = 0;
  let encoded = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return encoded;
}

export function generateKovaTotpEnrollment(email) {
  const normalizedEmail = normalizeKovaEmail(email);
  const secret = encodeBase32(randomBytes(20));
  const label = encodeURIComponent(`KovaGPT:${normalizedEmail}`);
  const issuer = encodeURIComponent("KovaGPT");
  return {
    secret,
    uri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
  };
}

function totpAt(secret, counter) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyKovaTotp(code, base32Secret, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/u.test(code) || !Number.isFinite(now)) return false;
  try {
    const secret = decodeBase32(base32Secret);
    const counter = Math.floor(now / 30_000);
    const submitted = Buffer.from(code, "ascii");
    for (let offset = -1; offset <= 1; offset += 1) {
      const expected = Buffer.from(totpAt(secret, counter + offset), "ascii");
      if (timingSafeEqual(submitted, expected)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function validatePassword(password) {
  assertWellFormed(password, "Password");
  const byteLength = Buffer.byteLength(password, "utf8");
  if (password.length < 12 || byteLength > 1024) {
    throw new RangeError("Password must be 12 or more characters and at most 1024 UTF-8 bytes");
  }
}

export async function hashKovaPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return [
    "scrypt-v1",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifyKovaPassword(password, encoded) {
  try {
    assertWellFormed(password, "Password");
    if (typeof encoded !== "string") return false;
    const [version, n, r, p, saltText, digestText, ...extra] = encoded.split("$");
    if (
      version !== "scrypt-v1" ||
      n !== String(SCRYPT_N) ||
      r !== String(SCRYPT_R) ||
      p !== String(SCRYPT_P) ||
      extra.length > 0
    ) {
      return false;
    }
    const salt = decodeBase64Url(saltText, "password salt");
    const expected = decodeBase64Url(digestText, "password digest");
    if (salt.length !== 16 || expected.length !== SCRYPT_BYTES) return false;
    const actual = await scrypt(password, salt, SCRYPT_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    return timingSafeEqual(Buffer.from(actual), expected);
  } catch {
    return false;
  }
}

function encryptionKey(env) {
  const encoded = env.KOVA_AUTH_ENCRYPTION_KEY;
  const expectedFingerprint = env.KOVA_AUTH_ENCRYPTION_KEY_SHA256;
  if (!encoded || !expectedFingerprint || !HEX_256_PATTERN.test(expectedFingerprint)) {
    throw new Error("Kova auth encryption configuration is incomplete");
  }
  const key = decodeBase64Url(encoded, "Kova auth encryption key");
  if (key.length !== 32) throw new Error("Kova auth encryption key must be 256 bits");
  const fingerprint = createHash("sha256").update(key).digest("hex");
  if (!timingSafeEqual(Buffer.from(fingerprint, "hex"), Buffer.from(expectedFingerprint, "hex"))) {
    throw new Error("Kova auth encryption key fingerprint mismatch");
  }
  return key;
}

export function encryptKovaSecret(plaintext, env = process.env) {
  assertWellFormed(plaintext, "Secret");
  const key = encryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptKovaSecret(envelope, env = process.env) {
  if (typeof envelope !== "string") throw new TypeError("Invalid encrypted secret");
  const [version, ivText, ciphertextText, tagText, ...extra] = envelope.split(".");
  if (version !== "v1" || extra.length > 0) throw new TypeError("Invalid encrypted secret");
  const key = encryptionKey(env);
  let iv;
  let ciphertext;
  let tag;
  try {
    iv = decodeBase64Url(ivText, "secret IV");
    ciphertext = decodeBase64Url(ciphertextText, "secret ciphertext");
    tag = decodeBase64Url(tagText, "secret tag");
  } catch {
    throw new TypeError("Invalid encrypted secret");
  }
  if (iv.length !== 12 || tag.length !== 16) throw new TypeError("Invalid encrypted secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new TypeError("Invalid encrypted secret");
  }
}

function signingConfiguration(env) {
  const pem = env.KOVA_AUTH_JWT_PRIVATE_KEY;
  const keyId = env.KOVA_AUTH_JWT_KEY_ID;
  const expectedFingerprint = env.KOVA_AUTH_JWT_PUBLIC_KEY_SHA256;
  const issuer = env.KOVA_AUTH_ISSUER;
  if (!pem || !keyId || !expectedFingerprint || !issuer) {
    throw new Error("Kova auth signing configuration is incomplete");
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) || !HEX_256_PATTERN.test(expectedFingerprint)) {
    throw new Error("Kova auth signing metadata is invalid");
  }
  const privateKey = createPrivateKey(pem.replaceAll("\\n", "\n"));
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("Kova auth compatibility JWTs require an ES256 P-256 key");
  }
  const publicKey = createPublicKey(privateKey);
  const fingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  if (!timingSafeEqual(Buffer.from(fingerprint, "hex"), Buffer.from(expectedFingerprint, "hex"))) {
    throw new Error("Kova auth signing key fingerprint mismatch");
  }
  const parsedIssuer = new URL(issuer);
  if (parsedIssuer.protocol !== "https:" || parsedIssuer.href !== issuer) {
    throw new Error("Kova auth issuer must be an exact HTTPS URL");
  }
  return { privateKey, keyId, issuer };
}

export function signKovaCompatibilityJwt(principal, env = process.env, now = Date.now()) {
  const { privateKey, keyId, issuer } = signingConfiguration(env);
  const issuedAt = Math.floor(now / 1000);
  if (
    !principal ||
    typeof principal.accountId !== "string" ||
    typeof principal.sessionId !== "string" ||
    typeof principal.email !== "string" ||
    !["aal1", "aal2"].includes(principal.assuranceLevel)
  ) {
    throw new TypeError("Invalid Kova auth principal");
  }
  const header = encodeJson({ alg: "ES256", typ: "JWT", kid: keyId });
  const payload = encodeJson({
    iss: issuer,
    aud: "authenticated",
    sub: principal.accountId,
    role: "authenticated",
    email: principal.email,
    email_verified: principal.emailVerified === true,
    aal: principal.assuranceLevel,
    session_id: principal.sessionId,
    iat: issuedAt,
    nbf: issuedAt - 5,
    exp: issuedAt + 300,
  });
  const signingInput = `${header}.${payload}`;
  const signature = signBytes("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export async function verifyGoogleIdToken(
  idToken,
  { clientId, expectedNonceDigest, fetchImpl = fetch, now = Date.now() },
) {
  if (typeof idToken !== "string" || idToken.length > 16_384) {
    throw new TypeError("Invalid Google ID token");
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new TypeError("Invalid Google ID token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader, "Google ID token header");
  const payload = decodeJson(encodedPayload, "Google ID token payload");
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") {
    throw new Error("Google ID token algorithm is not allowed");
  }
  const response = await fetchImpl(GOOGLE_JWKS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Google signing keys are unavailable");
  const jwks = await response.json();
  const jwk = Array.isArray(jwks?.keys)
    ? jwks.keys.find((candidate) => candidate?.kid === header.kid && candidate?.alg === "RS256")
    : null;
  if (!jwk) throw new Error("Google signing key is unknown");
  const verified = verifyBytes(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    createPublicKey({ key: jwk, format: "jwk" }),
    decodeBase64Url(encodedSignature, "Google ID token signature"),
  );
  if (!verified) throw new Error("Google ID token signature is invalid");

  const nowSeconds = Math.floor(now / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss) ||
    !audiences.includes(clientId) ||
    (audiences.length > 1 && payload.azp !== clientId) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= nowSeconds ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > nowSeconds + 300 ||
    typeof payload.nonce !== "string" ||
    !digestMatches(payload.nonce, expectedNonceDigest) ||
    typeof payload.sub !== "string" ||
    payload.sub.length < 1 ||
    payload.sub.length > 512 ||
    payload.email_verified !== true
  ) {
    throw new Error("Google ID token claims are invalid");
  }
  return {
    subject: payload.sub,
    email: normalizeKovaEmail(payload.email),
    emailVerified: true,
    displayName: typeof payload.name === "string" ? payload.name.slice(0, 120) : "",
  };
}

export const KOVA_AUTH_SESSION_SECONDS = 60 * 60 * 24 * 30;
export const KOVA_AUTH_CHALLENGE_SECONDS = 60 * 60;
export const KOVA_AUTH_HANDOFF_SECONDS = 120;
