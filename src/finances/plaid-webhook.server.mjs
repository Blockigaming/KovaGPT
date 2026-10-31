import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

// https://plaid.com/docs/api/webhooks/webhook-verification/
// Verify the original bytes. Neither a proxy header nor parsed/reformatted JSON
// establishes that Plaid signed the body.
export function opaqueFinanceId(namespace, value) {
  const h = createHash("sha256").update(`${namespace}\0${value}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function createPlaidWebhookVerifier(requestPlaid, now = Date.now) {
  const keys = new Map();
  return async (raw, jwt) => {
    if (typeof jwt !== "string" || jwt.length > 8192 || typeof raw !== "string")
      throw new Error("invalid_webhook_signature");
    const parts = jwt.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part)))
      throw new Error("invalid_webhook_signature");
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("invalid_webhook_signature");
    }
    if (
      header?.alg !== "ES256" ||
      header.crit !== undefined ||
      typeof header.kid !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(header.kid) ||
      !Number.isSafeInteger(claims?.iat) ||
      claims.iat * 1000 < now() - 300_000 ||
      claims.iat * 1000 > now() + 30_000 ||
      typeof claims.request_body_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(claims.request_body_sha256)
    )
      throw new Error("invalid_webhook_signature");

    let cached = keys.get(header.kid);
    if (!cached || cached.until <= now()) {
      // Key IDs select only this fixed Plaid endpoint, never a JWT-supplied URL.
      const { key } = await requestPlaid("/webhook_verification_key/get", { key_id: header.kid });
      if (
        key?.kid !== header.kid ||
        key.alg !== "ES256" ||
        key.kty !== "EC" ||
        key.crv !== "P-256" ||
        key.use !== "sig" ||
        !Number.isSafeInteger(key.created_at) ||
        key.created_at > claims.iat ||
        key.expired_at !== null
      )
        throw new Error("invalid_webhook_signature");
      let publicKey;
      try {
        publicKey = createPublicKey({ key, format: "jwk" });
      } catch {
        throw new Error("invalid_webhook_signature");
      }
      cached = { publicKey, until: now() + 300_000 };
      if (keys.size >= 16) keys.delete(keys.keys().next().value);
      keys.set(header.kid, cached);
    }
    const signature = Buffer.from(parts[2], "base64url");
    const bodyHash = createHash("sha256").update(raw, "utf8").digest();
    if (
      signature.length !== 64 ||
      !verify(
        "sha256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: cached.publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      ) ||
      !timingSafeEqual(bodyHash, Buffer.from(claims.request_body_sha256, "hex"))
    )
      throw new Error("invalid_webhook_signature");
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new Error("invalid_webhook");
    }
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      !["webhook_type", "webhook_code"].every(
        (key) => typeof event[key] === "string" && /^[A-Z_]{1,80}$/u.test(event[key]),
      ) ||
      typeof event.item_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/u.test(event.item_id)
    )
      throw new Error("invalid_webhook");
    return {
      itemId: event.item_id,
      type: event.webhook_type,
      code: event.webhook_code,
      bodyHash: bodyHash.toString("hex"),
    };
  };
}
