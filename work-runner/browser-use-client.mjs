/** Offline-tested lifecycle primitive only. NOT a kova-browser-v1 implementation.
 * No environment lookup, default fetch, CDP driver, route, or readiness registration.
 * See docs/browser-use-adapter-security-gate.md before any runtime integration. */
const ORIGIN = "https://api.browser-use.com/api/v4/browsers";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (code) => new Error(`browser_use_${code}`);

export function validateBrowserUseConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error("invalid_config");
  if (Object.keys(input).some((key) => !["enabled", "apiKey", "maxSessionMinutes"].includes(key)))
    throw error("invalid_config");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw error("invalid_config");
  if (input.enabled !== true) return Object.freeze({ enabled: false });
  const minutes = input.maxSessionMinutes ?? 5;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 5) throw error("invalid_config");
  if (typeof input.apiKey !== "string" || !/^[\x21-\x7e]{1,512}$/.test(input.apiKey))
    throw error("invalid_config");
  // Never serialize the key through diagnostics/config inspection.
  const config = { enabled: true, maxSessionMinutes: minutes };
  Object.defineProperty(config, "apiKey", { value: input.apiKey });
  return Object.freeze(config);
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw error("invalid_response");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) throw error("invalid_response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function cdpUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw error("invalid_response");
  const url = new URL(value);
  // Fail closed if the provider changes its endpoint domain; review before widening.
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "browser-use.com" || url.hostname.endsWith(".browser-use.com"))
  )
    throw error("invalid_response");
  return value;
}

export function createBrowserUseClient(input = {}, { fetchImpl } = {}) {
  const config = validateBrowserUseConfig(input);
  const owned = new Set();
  function requireEnabled() {
    if (!config.enabled) throw error("disabled");
    if (typeof fetchImpl !== "function") throw error("transport_required");
  }
  async function request(path, method, body, signal) {
    requireEnabled();
    try {
      signal?.throwIfAborted();
      const response = await fetchImpl(`${ORIGIN}${path}`, {
        method,
        redirect: "error",
        cache: "no-store",
        headers: { "X-Browser-Use-API-Key": config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw error("request_failed");
      }
      return await boundedJson(response);
    } catch {
      // Do not propagate provider bodies, URLs, authorization headers, or fetch errors.
      throw error(signal?.aborted ? "canceled" : "request_failed");
    }
  }
  async function stop(id) {
    requireEnabled();
    if (!UUID.test(id) || !owned.has(id)) throw error("unowned_session");
    // Cleanup has a fresh timeout, independent of the canceled task signal.
    // Keep ownership on uncertain failure; callers may reconcile before retrying.
    const result = await request(`/${id}`, "PATCH", { action: "stop" });
    if (result.id !== id || result.status !== "stopped") throw error("stop_unconfirmed");
    owned.delete(id);
  }
  async function create({ signal } = {}) {
    requireEnabled();
    const raw = await request(
      "",
      "POST",
      {
        timeout: config.maxSessionMinutes,
        proxyCountryCode: null,
        enableRecording: false,
        solveCaptchas: false,
      },
      signal,
    );
    if (!raw || typeof raw !== "object" || !UUID.test(raw.id)) throw error("create_unconfirmed");
    if (owned.has(raw.id)) throw error("create_unconfirmed");
    owned.add(raw.id);
    try {
      if (raw.status !== "active") throw error("invalid_response");
      const url = cdpUrl(raw.cdpUrl);
      signal?.throwIfAborted();
      const handle = { id: raw.id, maxSessionMinutes: config.maxSessionMinutes };
      Object.defineProperty(handle, "cdpUrl", { value: url });
      return Object.freeze(handle);
    } catch {
      await stop(raw.id);
      throw error(signal?.aborted ? "canceled" : "invalid_response");
    }
  }
  async function withSession(operation, { signal } = {}) {
    if (typeof operation !== "function") throw error("invalid_operation");
    const session = await create({ signal });
    const lifetime = AbortSignal.any([
      AbortSignal.timeout(config.maxSessionMinutes * 60000),
      ...(signal ? [signal] : []),
    ]);
    let onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          lifetime.throwIfAborted();
          return operation(session, lifetime);
        }),
        new Promise((_, reject) => {
          onAbort = () => reject(error("canceled"));
          lifetime.addEventListener("abort", onAbort, { once: true });
          if (lifetime.aborted) onAbort();
        }),
      ]);
    } catch {
      throw error(lifetime.aborted ? "canceled" : "operation_failed");
    } finally {
      lifetime.removeEventListener("abort", onAbort);
      await stop(session.id);
    }
  }
  return Object.freeze({ create, stop, withSession });
}
