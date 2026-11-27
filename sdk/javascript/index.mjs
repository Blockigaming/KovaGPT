const operations = new Set([
  "responses",
  "images",
  "embeddings",
  "moderations",
  "search",
  "chat/completions",
  "decisions",
  "agent-turns",
]);
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
    this.chat = Object.freeze({
      completions: Object.freeze({
        create: (input, options) => this.run("chat/completions", input, options),
      }),
    });
    this.search = (input, options) => this.run("search", input, options);
    this.decisions = Object.freeze({ create: (input, options) => this.run("decisions", input, options) });
    this.images = Object.freeze({
      generate: (input, options) => this.run("images", input, options),
      edit: (input, options) => {
        if (typeof input?.image !== "string" || !input.image.startsWith("data:image/png;base64,"))
          return Promise.reject(new KovaError("image_required"));
        return this.run("images", input, options);
      },
    });
    this.embeddings = Object.freeze({
      create: (input, options) => this.run("embeddings", input, options),
    });
    this.moderations = Object.freeze({
      create: (input, options) => this.run("moderations", input, options),
    });
    this.usage = Object.freeze({
      list: async ({ limit = 25, offset = 0, signal } = {}) => {
        if (
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > 10000
        )
          fail("usage_pagination_invalid");
        return smallJson(
          await this.#request(`usage?limit=${limit}&offset=${offset}`, { signal }),
          131072,
        );
      },
      retrieve: async (id, { signal } = {}) => {
        if (
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        )
          fail("usage_id_invalid");
        return smallJson(await this.#request(`usage?id=${id}`, { signal }));
      },
    });
    const fileId = (id) => {
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        fail("file_id_invalid");
      return id;
    };
    const vectorPath = (id, entry) => {
      if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        fail("vector_id_invalid");
      if (entry !== undefined && (typeof entry !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(entry)))
        fail("vector_entry_invalid");
      return "vector-stores?id=" + id + (entry === undefined ? "" : "&entry_id=" + entry);
    };
    const vectorPost = async (operation, input, { signal, headers } = {}) =>
      smallJson(await this.#request("vector-stores", {
        input: boundedInput({ ...boundedInput(input), operation }), signal, headers,
      }), 1048576);
    const conversationPath = (id, item) => {
      const valid = (value) =>
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if (!valid(id) || (item !== undefined && !valid(item))) fail("conversation_id_invalid");
      return "conversations?id=" + id + (item === undefined ? "" : "&item_id=" + item);
    };
    const conversationPost = async (operation, input, { signal } = {}) =>
      smallJson(
        await this.#request("conversations", {
          input: boundedInput({ ...boundedInput(input), operation }, 16384),
          signal,
        }),
        131072,
      );
    const agentPath = (id, version) => {
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        fail("agent_id_invalid");
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 20))
        fail("agent_version_invalid");
      return "agents?id=" + id + (version === undefined ? "" : "&version=" + version);
    };
    const agentPost = async (operation, input, { signal } = {}) =>
      smallJson(
        await this.#request("agents", {
          input: boundedInput({ ...boundedInput(input), operation }, 16384),
          signal,
        }),
        65536,
      );
    this.agents = Object.freeze({
      create: (input, options) => agentPost("create", input, options),
      update: (input, options) => agentPost("update", input, options),
      list: async ({ signal } = {}) => smallJson(await this.#request("agents", { signal })),
      retrieve: async (id, { version, signal } = {}) =>
        smallJson(await this.#request(agentPath(id, version), { signal })),
      delete: async (id, { signal } = {}) =>
        smallJson(await this.#request(agentPath(id), { method: "DELETE", signal })),
      turn: (input, options) => this.run("agent-turns", input, options),
    });
    const skillPath = (id, version) => {
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        fail("skill_id_invalid");
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 20))
        fail("skill_version_invalid");
      return "skills?id=" + id + (version === undefined ? "" : "&version=" + version);
    };
    const skillPost = async (operation, input, { signal } = {}) =>
      smallJson(
        await this.#request("skills", {
          input: boundedInput({ ...boundedInput(input), operation }, 16384),
          signal,
        }),
        65536,
      );
    this.skills = Object.freeze({
      create: (input, options) => skillPost("create", input, options),
      update: (input, options) => skillPost("update", input, options),
      list: async ({ signal } = {}) => smallJson(await this.#request("skills", { signal })),
      retrieve: async (id, { version, signal } = {}) =>
        smallJson(await this.#request(skillPath(id, version), { signal })),
      delete: async (id, { signal } = {}) =>
        smallJson(await this.#request(skillPath(id), { method: "DELETE", signal })),
    });
    this.conversations = Object.freeze({
      create: (input, options) => conversationPost("create", input, options),
      append: (input, options) => conversationPost("append", input, options),
      remove: (input, options) => conversationPost("remove", input, options),
      list: async ({ signal } = {}) =>
        smallJson(await this.#request("conversations", { signal }), 131072),
      retrieve: async (id, { signal } = {}) =>
        smallJson(await this.#request(conversationPath(id), { signal }), 131072),
      retrieveItem: async (id, item, { signal } = {}) => {
        if (item === undefined) fail("conversation_id_invalid");
        return smallJson(await this.#request(conversationPath(id, item), { signal }), 131072);
      },
      delete: async (id, { signal } = {}) =>
        smallJson(await this.#request(conversationPath(id), { signal, method: "DELETE" })),
    });
    this.vectorStores = Object.freeze({
      create: async (input, { idempotencyKey, signal } = {}) => {
        if (typeof idempotencyKey !== "string" || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
          fail("idempotency_key_required");
        return vectorPost("create", input, { signal, headers: { "Idempotency-Key": idempotencyKey } });
      },
      upsert: (input, options) => vectorPost("upsert", input, { signal: options?.signal }),
      search: (input, options) => vectorPost("search", input, { signal: options?.signal }),
      list: async ({ signal } = {}) => smallJson(await this.#request("vector-stores", { signal }), 1048576),
      retrieve: async (id, { signal } = {}) => smallJson(await this.#request(vectorPath(id), { signal }), 1048576),
      listEntries: async (id, { page = 0, signal } = {}) => {
        if (!Number.isSafeInteger(page) || page < 0 || page > 19) fail("vector_page_invalid");
        return smallJson(await this.#request(vectorPath(id) + "&entries=true&page=" + page, { signal }), 1048576);
      },
      retrieveEntry: async (id, entry, { signal } = {}) => {
        if (entry === undefined) fail("vector_entry_invalid");
        return smallJson(await this.#request(vectorPath(id, entry), { signal }), 1048576);
      },
      delete: async (id, { signal } = {}) =>
        smallJson(await this.#request(vectorPath(id), { signal, method: "DELETE" })),
      deleteEntry: async (id, entry, { signal } = {}) => {
        if (entry === undefined) fail("vector_entry_invalid");
        return smallJson(await this.#request(vectorPath(id, entry), { signal, method: "DELETE" }));
      },
    });
    this.files = Object.freeze({
      search: async (input, { signal } = {}) =>
        smallJson(
          await this.#request("file-search", { input: boundedInput(input), signal }),
          65536,
        ),
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
  async models({ id, signal } = {}) {
    if (
      id !== undefined &&
      (typeof id !== "string" ||
        id.length < 2 ||
        id.length > 80 ||
        !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/.test(id))
    )
      fail("model_id_invalid");
    return smallJson(
      await this.#request(id === undefined ? "models" : `models?id=${id}`, { signal }),
    );
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
async function* streamEvents(response, { maximumEventBytes = 1048576 } = {}, chat = false) {
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
        if (terminal || !event || typeof event !== "object" || Array.isArray(event))
          fail("stream_event_invalid");
        if (chat) {
          if (event.object !== "chat.completion.chunk" || !Array.isArray(event.choices) ||
              event.choices.length !== 1 || event.choices[0]?.index !== 0 ||
              ![null, "stop", "length", "content_filter"].includes(event.choices[0].finish_reason))
            fail("stream_event_invalid");
          terminal = event.choices[0].finish_reason !== null;
        } else if (["response.completed", "response.incomplete", "response.failed", "error"].includes(event.type))
          terminal = true;
        yield event;
      }
      if (new TextEncoder().encode(buffer).length > maximumEventBytes)
        fail("stream_event_too_large");
      if (done) {
        if (buffer.trim() || !terminal || chat) fail("stream_truncated");
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function responseEvents(response, options) {
  return streamEvents(response, options);
}

export function chatCompletionEvents(response, options) {
  return streamEvents(response, options, true);
}
