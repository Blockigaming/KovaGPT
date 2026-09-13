import { encodePushKey } from "./push-policy.mjs";
async function key(secret) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("push_vault_unavailable");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kova-web-push-v1:${secret}`)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function sealPushSubscription(value, ownerId, id, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${ownerId}:${id}`) },
      await key(secret),
      new TextEncoder().encode(JSON.stringify(value)),
    );
  return `push1.${encodePushKey(iv)}.${encodePushKey(new Uint8Array(cipher))}`;
}
export async function openPushSubscription(value, ownerId, id, secret) {
  if (typeof value !== "string" || value.length > 12000) throw new Error("push_vault_invalid");
  const [prefix, nonce, body, ...rest] = value.split(".");
  if (prefix !== "push1" || rest.length || !nonce || !body) throw new Error("push_vault_invalid");
  const from = (s) =>
    Uint8Array.from(atob(s.replace(/-/gu, "+").replace(/_/gu, "/")), (c) => c.charCodeAt(0));
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from(nonce),
          additionalData: new TextEncoder().encode(`${ownerId}:${id}`),
        },
        await key(secret),
        from(body),
      ),
    ),
  );
}
