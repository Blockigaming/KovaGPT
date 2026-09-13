import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptPushPayload,
  vapidAuthorization,
  sendWebPush,
} from "../../src/lib/pwa/web-push.server.mjs";
import {
  decodePushKey,
  encodePushKey,
  normalizePushSubscription,
  isPushQuiet,
} from "../../src/lib/pwa/push-policy.mjs";
const sender =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const recipient =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/long-token",
  p256dh: recipient,
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const vapid = {
  publicKey: sender,
  privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  subject: "mailto:push@example.test",
};
async function keyPair() {
  const pub = decodePushKey(sender, 65);
  return {
    publicKey: await crypto.subtle.importKey(
      "raw",
      pub,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    ),
    privateKey: await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: encodePushKey(pub.slice(1, 33)),
        y: encodePushKey(pub.slice(33)),
        d: vapid.privateKey,
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    ),
  };
}
test("Web Push encryption matches the complete RFC 8291 section 5 ciphertext vector", async () => {
  const encrypted = await encryptPushPayload(
    subscription,
    new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    { keyPair: await keyPair(), salt: decodePushKey("DGv6ra1nlYgDCS1FRnbzlw", 16) },
  );
  assert.equal(
    encodePushKey(encrypted),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});
test("VAPID signs exact push origin with ES256 and a bounded expiry", async () => {
  const now = Date.now(),
    auth = await vapidAuthorization(subscription.endpoint, vapid, now),
    jwt = /t=([^,]+)/u.exec(auth)[1],
    parts = jwt.split(".");
  const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(decoded.aud, "https://fcm.googleapis.com");
  assert.equal(decoded.exp, Math.floor(now / 1000) + 3600);
  const key = await crypto.subtle.importKey(
    "raw",
    decodePushKey(sender, 65),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assert.equal(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(parts[2], "base64url"),
      new TextEncoder().encode(parts.slice(0, 2).join(".")),
    ),
    true,
  );
});
test("subscription endpoints and key formats fail closed before any transport", () => {
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/id",
    "https://localhost/private",
    "https://fcm.googleapis.com.attacker.test/fcm/send/id",
    "https://fcm.googleapis.com:8443/fcm/send/id",
    "https://fcm.googleapis.com/fcm/send/id?token=secret",
  ])
    assert.throws(() =>
      normalizePushSubscription({ endpoint, keys: { p256dh: recipient, auth: subscription.auth } }),
    );
  assert.throws(() => decodePushKey("A".repeat(87), 65));
  assert.throws(() =>
    normalizePushSubscription({
      endpoint: subscription.endpoint,
      keys: { p256dh: recipient, auth: "short" },
    }),
  );
});
test("quiet hours handle overnight windows, exact boundaries and invalid zones", () => {
  const quiet = { start: "22:00", end: "07:00", timeZone: "UTC" };
  assert.equal(isPushQuiet(quiet, Date.parse("2026-09-05T23:00Z")), true);
  assert.equal(isPushQuiet(quiet, Date.parse("2026-09-05T06:59Z")), true);
  assert.equal(isPushQuiet(quiet, Date.parse("2026-09-05T07:00Z")), false);
  assert.throws(() => isPushQuiet({ ...quiet, timeZone: "not/a-zone" }));
  assert.throws(() => isPushQuiet({ ...quiet, start: "27:00" }));
});
test("revoked consent stops transport and expired push endpoints are terminal", async () => {
  let sends = 0;
  await assert.rejects(
    sendWebPush(
      {
        ...subscription,
        id: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        eventSource: "application",
        eventAt: new Date().toISOString(),
      },
      vapid,
      {
        signal: AbortSignal.timeout(10000),
        assertCurrent: async () => {
          throw Error("revoked");
        },
        fetchImpl: async () => {
          sends++;
          return new Response(null, { status: 201 });
        },
      },
    ),
    /revoked/,
  );
  assert.equal(sends, 0);
  assert.equal(
    await sendWebPush(
      {
        ...subscription,
        id: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        eventSource: "application",
        eventAt: new Date().toISOString(),
      },
      vapid,
      {
        signal: AbortSignal.timeout(10000),
        assertCurrent: async () => {},
        fetchImpl: async (url, init) => {
          assert.equal(url, subscription.endpoint);
          assert.equal(init.redirect, "error");
          assert.equal(init.headers["Content-Encoding"], "aes128gcm");
          assert.equal(init.headers.TTL, "300");
          return new Response(null, { status: 410 });
        },
      },
    ),
    "expired",
  );
});

test("subscription vault ciphertext is bound to the exact owner and immutable device row", async () => {
  const { sealPushSubscription, openPushSubscription } =
    await import("../../src/lib/pwa/push-vault.server.mjs");
  const value = {
      endpoint: "https://fcm.googleapis.com/fcm/send/example",
      p256dh: "public-key",
      auth: "private-auth",
    },
    owner = crypto.randomUUID(),
    id = crypto.randomUUID(),
    secret = "vault-fixture-key-at-least-sixteen";
  const sealed = await sealPushSubscription(value, owner, id, secret);
  assert.doesNotMatch(sealed, /private-auth|googleapis/);
  assert.deepEqual(await openPushSubscription(sealed, owner, id, secret), value);
  await assert.rejects(openPushSubscription(sealed, crypto.randomUUID(), id, secret));
  await assert.rejects(openPushSubscription(sealed, owner, crypto.randomUUID(), secret));
  await assert.rejects(openPushSubscription(sealed, owner, id, "different-vault-key-secret"));
});
