const operations = new Set(["responses", "images", "embeddings"]);
export class KovaError extends Error {
  constructor(code, status = 0, requestMayHaveStarted = false) {
    super(code);
    this.name = "KovaError";
    this.code = code;
    this.status = status;
    this.requestMayHaveStarted = requestMayHaveStarted;
  }
}
const fail = (code) => {
  throw new KovaError(code);
};
function operation(value) {
  if (!operations.has(value)) fail("operation_invalid");
}
function budget(value) {
  if (
    !value ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !Number.isFinite(value.maximumCharge) ||
    value.maximumCharge <= 0 ||
    value.maximumCharge > 1e9
  )
    fail("budget_required");
}
function boundedInput(value, maximumBytes = 65536) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail("input_invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    new TextEncoder().encode(encoded).length > maximumBytes
  )
    fail("input_invalid");
  return JSON.parse(encoded);
}
async function smallJson(response, maximumBytes = 65536) {
  const reader = response.body?.getReader();
  if (!reader) fail("response_invalid");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) fail("response_too_large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Server-side SDK. It never performs implicit provider retries or executes model-suggested tools. */
export class KovaGPT {
  #apiKey;
  #origin;
  #fetch;
  #timeout;
  constructor({
    apiKey,
    baseURL = "https://kovagpt.com",
    fetch: transport = globalThis.fetch,
    timeoutMs = 60000,
  } = {}) {
    if (typeof window !== "undefined" && window.document) fail("browser_secret_forbidden");
    if (typeof apiKey !== "string" || !/^kova_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(apiKey))
      fail("credential_invalid");
    let url;
    try {
      url = new URL(baseURL);
    } catch {
      fail("origin_invalid");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !["", "/"].includes(url.pathname) ||
      url.search ||
      url.hash
    )
      fail("origin_invalid");
    if (
      typeof transport !== "function" ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 300000
    )
      fail("client_configuration_invalid");
    this.#apiKey = apiKey;
    this.#origin = url.origin;
    this.#fetch = transport;
    this.#timeout = timeoutMs;
    this.responses = Object.freeze({
      create: (input, options) => this.run("responses", input, options),
    });
    this.images = Object.freeze({
      generate: (input, options) => this.run("images", input, options),
    });
    this.embeddings = Object.freeze({
      create: (input, options) => this.run("embeddings", input, options),
    });
    const fileId = (id) => {
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        fail("file_id_invalid");
      return id;
    };
    this.files = Object.freeze({
      upload: async (input, { idempotencyKey, signal } = {}) => {
        if (typeof idempotencyKey !== "string" || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
          fail("idempotency_key_required");
        return smallJson(
          await this.#request("files", {
            input: boundedInput(input, 131072),
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
          }),
        );
      },
      list: async ({ page = 0, signal } = {}) => {
        if (!Number.isSafeInteger(page) || page < 0 || page > 4) fail("file_page_invalid");
        return smallJson(await this.#request(`files?page=${page}`, { signal }));
      },
      retrieve: async (id, { signal } = {}) =>
        smallJson(await this.#request(`files?id=${fileId(id)}`, { signal }), 131072),
      delete: async (id, { signal } = {}) =>
        smallJson(await this.#request(`files?id=${fileId(id)}`, { signal, method: "DELETE" })),
    });
  }
  async #request(path, { input, signal, headers = {}, generation = false, method } = {}) {
    const combined = AbortSignal.any([
      AbortSignal.timeout(this.#timeout),
      ...(signal ? [signal] : []),
    ]);
    if (combined.aborted) throw new KovaError("request_aborted");
    let response;
    try {
      response = await this.#fetch(`${this.#origin}/api/v1/${path}`, {
        method: method ?? (input === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          ...(input === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: combined,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new KovaError(combined.aborted ? "request_aborted" : "transport_failed", 0, generation);
    }
    if (!response.ok) {
      let code = "request_failed";
      try {
        const data = await smallJson(response);
        if (/^developer_[a-z_]{1,80}$/.test(data?.error?.code)) code = data.error.code;
      } catch {
        /* Never expose arbitrary response bodies or transport errors. */
      }
      throw new KovaError(code, response.status, generation && response.status >= 500);
    }
    return response;
  }
  async models({ signal } = {}) {
    return smallJson(await this.#request("models", { signal }));
  }
  async quote(kind, input, { signal } = {}) {
    operation(kind);
    return smallJson(
      await this.#request("quotes", {
        input: { operation: kind, input: boundedInput(input) },
        signal,
      }),
    );
  }
  async execute(kind, input, options) {
    operation(kind);
    budget(options);
    const { quote, signal, idempotencyKey, currency, maximumCharge } = options;
    if (typeof idempotencyKey !== "string" || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
      fail("idempotency_key_required");
    if (
      !quote ||
      typeof quote.quoteToken !== "string" ||
      quote.quoteToken.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(quote.quoteToken) ||
      !Number.isFinite(quote.maximumCharge) ||
      quote.maximumCharge <= 0 ||
      !Number.isSafeInteger(quote.expiresAt) ||
      quote.expiresAt <= Date.now() ||
      quote.expiresAt > Date.now() + 120000 ||
      quote.currency !== currency ||
      quote.maximumCharge > maximumCharge
    )
      fail("quote_outside_budget");
    return this.#request(kind, {
      input: boundedInput(input),
      signal,
      generation: true,
      headers: { "Idempotency-Key": idempotencyKey, "X-Kova-Quote": quote.quoteToken },
    });
  }
  async run(kind, input, options) {
    budget(options);
    // Snapshot before the first await; client mutation cannot change the accepted operation.
    const snapshot = boundedInput(input);
    const accepted = { ...options };
    if (
      typeof accepted.idempotencyKey !== "string" ||
      !/^[\x21-\x7e]{1,128}$/.test(accepted.idempotencyKey)
    )
      fail("idempotency_key_required");
    const quote = await this.quote(kind, snapshot, { signal: accepted.signal });
    return this.execute(kind, snapshot, { ...accepted, quote });
  }
}

/** Reading stops and cancels upstream when the caller breaks or throws. */
export async function* responseEvents(response, { maximumEventBytes = 1048576 } = {}) {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body ||
    !Number.isSafeInteger(maximumEventBytes) ||
    maximumEventBytes < 1 ||
    maximumEventBytes > 1048576
  )
    fail("stream_invalid");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (new TextEncoder().encode(frame).length > maximumEventBytes)
          fail("stream_event_too_large");
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          if (!terminal) fail("stream_truncated");
          return;
        }
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          fail("stream_event_invalid");
        }
        if (
          ["response.completed", "response.incomplete", "response.failed", "error"].includes(
            event?.type,
          )
        )
          terminal = true;
        yield event;
      }
      if (new TextEncoder().encode(buffer).length > maximumEventBytes)
        fail("stream_event_too_large");
      if (done) {
        if (buffer.trim() || !terminal) fail("stream_truncated");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
