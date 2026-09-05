import { decodePushKey, encodePushKey, pushEndpoint } from "./push-policy.mjs";
const bytes = (text) => new TextEncoder().encode(text);
const concat = (...values) => {
  const result = new Uint8Array(values.reduce((sum, v) => sum + v.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
};
async function hmac(key, value) {
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      value,
    ),
  );
}
/** RFC 8291 one-record aes128gcm; deterministic key/salt injection is for vectors. */
export async function encryptPushPayload(subscription, payload, { keyPair, salt } = {}) {
  if (!(payload instanceof Uint8Array) || payload.length > 3000)
    throw new Error("push_payload_invalid");
  const recipient = decodePushKey(subscription.p256dh, 65),
    auth = decodePushKey(subscription.auth, 16);
  keyPair ??= await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  if (!(salt instanceof Uint8Array) || salt.length !== 16) throw new Error("push_salt_invalid");
  const sender = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const recipientKey = await crypto.subtle.importKey(
    "raw",
    recipient,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: recipientKey }, keyPair.privateKey, 256),
  );
  const authKey = await hmac(auth, shared),
    ikm = await hmac(
      authKey,
      concat(bytes("WebPush: info\0"), recipient, sender, new Uint8Array([1])),
    ),
    prk = await hmac(salt, ikm);
  const cek = (
    await hmac(prk, concat(bytes("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, concat(bytes("Content-Encoding: nonce\0"), new Uint8Array([1])))
  ).slice(0, 12);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]),
      concat(payload, new Uint8Array([2])),
    ),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, sender, encrypted);
}
export async function vapidAuthorization(
  endpoint,
  { publicKey, privateKey, subject },
  now = Date.now(),
) {
  const audience = pushEndpoint(endpoint).origin,
    pub = decodePushKey(publicKey, 65),
    secret = decodePushKey(privateKey, 32);
  if (
    typeof subject !== "string" ||
    subject.length > 250 ||
    !/^(?:mailto:[^\s<>]+@[^\s<>]+|https:\/\/[^\s<>]+)$/u.test(subject)
  )
    throw new Error("push_vapid_invalid");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: encodePushKey(pub.slice(1, 33)),
    y: encodePushKey(pub.slice(33)),
    d: encodePushKey(secret),
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const value = `${encodePushKey(bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${encodePushKey(bytes(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 3600, sub: subject })))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes(value)),
  );
  const verify = await crypto.subtle.importKey(
    "raw",
    pub,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verify,
      signature,
      bytes(value),
    ))
  )
    throw new Error("push_vapid_invalid");
  return `vapid t=${value}.${encodePushKey(signature)}, k=${publicKey}`;
}
export async function sendWebPush(
  subscription,
  config,
  { assertCurrent, signal, fetchImpl = fetch },
) {
  const endpoint = pushEndpoint(subscription.endpoint).href;
  if (
    !/^[a-f0-9-]{36}$/iu.test(subscription.eventId ?? "") ||
    !["application", "agent"].includes(subscription.eventSource) ||
    !Number.isFinite(Date.parse(subscription.eventAt))
  )
    throw new Error("push_event_invalid");
  // Keep task text, sender names, billing and private content off lock screens.
  const body = await encryptPushPayload(
    subscription,
    bytes(
      JSON.stringify({
        version: 1,
        subscriptionId: subscription.id,
        eventId: subscription.eventId,
        eventSource: subscription.eventSource,
        eventAt: subscription.eventAt,
      }),
    ),
  );
  const authorization = await vapidAuthorization(endpoint, config);
  await assertCurrent();
  signal.throwIfAborted();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "300",
      Urgency: "normal",
    },
    body,
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  });
  void response.body?.cancel().catch(() => {});
  return response.status === 201
    ? "sent"
    : [404, 410].includes(response.status)
      ? "expired"
      : "retry";
}
