import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypes = ["request.settled", "request.rejected"];
const fail = () => {
  throw new Error("developer_webhook_invalid");
};
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value.toLowerCase();
}
export function webhookDestination(value, allowlist) {
  if (typeof value !== "string" || value.length > 1024 || !Array.isArray(allowlist)) fail();
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.href !== value ||
    !/^[a-z0-9](?:[a-z0-9.-]{1,250})\.[a-z][a-z0-9-]{0,62}$/.test(url.hostname) ||
    url.hostname.includes("..") ||
    /\.(?:localhost|local|internal|test|invalid|onion)$/.test(url.hostname) ||
    !allowlist.includes(value)
  )
    fail();
  return url;
}
export function publicWebhookIPv4(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value))
    return false;
  const [a, b, c, d] = value.split(".").map(Number);
  return !(
    [a, b, c, d].some((part) => part > 255) ||
    [0, 10, 127].includes(a) ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function parseDeveloperWebhookRequest(method, params, body, allowlist) {
  for (const key of params.keys())
    if (!["id", "deliveries"].includes(key) || params.getAll(key).length !== 1) fail();
  if (method === "POST") {
    if ([...params.keys()].length) fail();
    if (body?.operation === "create") {
      exact(body, ["operation", "id", "url", "events"]);
      if (
        !Array.isArray(body.events) ||
        body.events.length < 1 ||
        body.events.length > eventTypes.length ||
        new Set(body.events).size !== body.events.length ||
        body.events.some((type) => !eventTypes.includes(type))
      )
        fail();
      return {
        operation: "create",
        input: { id: id(body.id), url: webhookDestination(body.url, allowlist).href, events: [...body.events].sort() },
      };
    }
    if (body?.operation === "rotate") {
      exact(body, ["operation", "id", "expected_generation"]);
      if (!Number.isSafeInteger(body.expected_generation) || body.expected_generation < 1 || body.expected_generation > 999)
        fail();
      return {
        operation: "rotate",
        input: { id: id(body.id), expected_generation: body.expected_generation },
      };
    }
    if (body?.operation === "test") {
      exact(body, ["operation", "id", "event_id"]);
      return { operation: "test", input: { id: id(body.id), event_id: id(body.event_id) } };
    }
    fail();
  }
  const endpoint = params.get("id");
  const deliveries = params.get("deliveries");
  if (method === "GET") {
    if (endpoint === null) {
      if (deliveries !== null) fail();
      return { operation: "list", input: {} };
    }
    if (deliveries !== null && deliveries !== "true") fail();
    return { operation: deliveries === null ? "get" : "deliveries", input: { id: id(endpoint) } };
  }
  if (method === "DELETE" && endpoint !== null && deliveries === null)
    return { operation: "delete", input: { id: id(endpoint) } };
  fail();
}
export function developerWebhookSecret(master, endpoint) {
  if (
    typeof master !== "string" ||
    !/^[a-f0-9]{64}$/i.test(master) ||
    !Number.isSafeInteger(endpoint?.generation) ||
    endpoint.generation < 1 ||
    endpoint.generation > 1000
  )
    fail();
  const binding = [endpoint.project_id, endpoint.id, endpoint.api_key_id, endpoint.secret_nonce].map(id);
  return "whsec_" + createHmac("sha256", Buffer.from(master, "hex"))
    .update(JSON.stringify(["kova-webhook-v1", ...binding, endpoint.generation]))
    .digest("base64url");
}
export function developerWebhookSignature(secret, eventId, timestamp, body) {
  if (
    typeof secret !== "string" ||
    !/^whsec_[A-Za-z0-9_-]{43}$/.test(secret) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 1 ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 65536
  )
    fail();
  return "v1=" + createHmac("sha256", secret).update(id(eventId) + "." + timestamp + "." + body).digest("hex");
}
export function verifyDeveloperWebhook({ secret, eventId, timestamp, body, signature, now = Math.floor(Date.now() / 1000) }) {
  try {
    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(now - timestamp) > 300 ||
      typeof signature !== "string" ||
      !/^v1=[a-f0-9]{64}$/.test(signature)
    )
      return false;
    const expected = developerWebhookSignature(secret, eventId, timestamp, body);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
