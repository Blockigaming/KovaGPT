const QUEUES = Object.freeze(["auth_emails", "transactional_emails"]);
const PURPOSES = new Set(["auth", "transactional"]);
const TERMINAL_LOG_STATUSES = new Set(["sent", "suppressed", "bounced", "complained", "dlq"]);
const SAFE_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_HTML_BYTES = 1_000_000;
const MAX_TEXT_BYTES = 250_000;

export class EmailWorkerError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "EmailWorkerError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.retryable = options.retryable === true;
  }
}

function boundedInteger(env, name, fallback, min, max) {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new EmailWorkerError(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

function requiredSecret(env, name) {
  const value = String(env[name] ?? "").trim();
  if (
    value.length < 16 ||
    /^(?:todo|changeme|replace|placeholder|example|undefined|null)/i.test(value)
  ) {
    throw new EmailWorkerError(`missing_${name.toLowerCase()}`);
  }
  return value;
}

function httpsOrigin(value, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new EmailWorkerError(code);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new EmailWorkerError(code);
  }
  return url.origin;
}

function senderDomains(env) {
  const values = String(env.EMAIL_SENDER_DOMAINS ?? "notify.kovagpt.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length || values.some((value) => !DOMAIN.test(value))) {
    throw new EmailWorkerError("invalid_email_sender_domains");
  }
  return new Set(values);
}

export function loadEmailWorkerConfig(env = process.env) {
  if (env.KOVA_EMAIL_QUEUE_ENABLED !== "true") {
    throw new EmailWorkerError("email_queue_disabled");
  }
  return Object.freeze({
    supabaseUrl: httpsOrigin(String(env.SUPABASE_URL ?? ""), "invalid_supabase_url"),
    supabaseServiceKey: requiredSecret(env, "SUPABASE_SERVICE_ROLE_KEY"),
    resendApiKey: requiredSecret(env, "RESEND_API_KEY"),
    publicOrigin: httpsOrigin(
      String(env.KOVA_PUBLIC_ORIGIN ?? "https://kovagpt.com"),
      "invalid_public_origin",
    ),
    senderDomains: senderDomains(env),
    pollMs: boundedInteger(env, "EMAIL_WORKER_POLL_MS", 2_000, 250, 60_000),
    batchSize: boundedInteger(env, "EMAIL_WORKER_BATCH_SIZE", 10, 1, 100),
    concurrency: boundedInteger(env, "EMAIL_WORKER_CONCURRENCY", 2, 1, 10),
    visibilityTimeoutSeconds: boundedInteger(
      env,
      "EMAIL_WORKER_VISIBILITY_TIMEOUT_SECONDS",
      120,
      30,
      900,
    ),
    requestTimeoutMs: boundedInteger(env, "EMAIL_WORKER_REQUEST_TIMEOUT_MS", 10_000, 1_000, 30_000),
    maxAttempts: boundedInteger(env, "EMAIL_WORKER_MAX_ATTEMPTS", 5, 1, 20),
    authTtlMinutes: boundedInteger(env, "EMAIL_WORKER_AUTH_TTL_MINUTES", 15, 1, 120),
    transactionalTtlMinutes: boundedInteger(
      env,
      "EMAIL_WORKER_TRANSACTIONAL_TTL_MINUTES",
      60,
      1,
      1_380,
    ),
  });
}

function boundedString(value, code, max, { required = true } = {}) {
  if (typeof value !== "string") throw new EmailWorkerError(code);
  const normalized = value.trim();
  if (
    (required && !normalized) ||
    normalized.length > max ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new EmailWorkerError(code);
  }
  return normalized;
}

function senderAddress(value) {
  const normalized = boundedString(value, "invalid_sender", 320);
  const match = normalized.match(/<([^<>]+)>$/);
  const address = (match?.[1] ?? normalized).trim().toLowerCase();
  if (!EMAIL_ADDRESS.test(address)) throw new EmailWorkerError("invalid_sender");
  return { display: normalized, address, domain: address.slice(address.lastIndexOf("@") + 1) };
}

function bodyBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function parseEmailQueueMessage(value, config, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailWorkerError("invalid_email_payload");
  }
  const messageId = boundedString(value.message_id, "invalid_message_id", 128);
  if (!SAFE_MESSAGE_ID.test(messageId)) throw new EmailWorkerError("invalid_message_id");
  const idempotencyKey = boundedString(
    value.idempotency_key ?? messageId,
    "invalid_idempotency_key",
    256,
  );
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new EmailWorkerError("invalid_idempotency_key");
  }
  const to = boundedString(value.to, "invalid_recipient", 254).toLowerCase();
  if (!EMAIL_ADDRESS.test(to)) throw new EmailWorkerError("invalid_recipient");
  const from = senderAddress(value.from);
  if (!config.senderDomains.has(from.domain)) {
    throw new EmailWorkerError("sender_domain_not_allowed");
  }
  const subject = boundedString(value.subject, "invalid_subject", 200);
  const html = typeof value.html === "string" ? value.html : "";
  const text = typeof value.text === "string" ? value.text : "";
  if ((!html && !text) || bodyBytes(html) > MAX_HTML_BYTES || bodyBytes(text) > MAX_TEXT_BYTES) {
    throw new EmailWorkerError("invalid_email_body");
  }
  const purpose = boundedString(value.purpose ?? "transactional", "invalid_email_purpose", 32);
  if (!PURPOSES.has(purpose)) throw new EmailWorkerError("invalid_email_purpose");
  const queuedAt = Date.parse(String(value.queued_at ?? ""));
  if (!Number.isFinite(queuedAt) || queuedAt > now + 60_000) {
    throw new EmailWorkerError("invalid_queued_at");
  }
  const ttlMinutes = purpose === "auth" ? config.authTtlMinutes : config.transactionalTtlMinutes;
  if (now - queuedAt > ttlMinutes * 60_000) {
    throw new EmailWorkerError("email_expired");
  }
  let unsubscribeToken = null;
  if (value.unsubscribe_token !== undefined && value.unsubscribe_token !== null) {
    unsubscribeToken = boundedString(value.unsubscribe_token, "invalid_unsubscribe_token", 128);
    if (!/^[a-f0-9]{64,128}$/i.test(unsubscribeToken)) {
      throw new EmailWorkerError("invalid_unsubscribe_token");
    }
  }
  return Object.freeze({
    messageId,
    idempotencyKey,
    to,
    from: from.display,
    subject,
    html,
    text,
    purpose,
    unsubscribeToken,
  });
}

function retryAfterMs(headers) {
  const raw = headers?.get?.("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 900_000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 900_000)) : 0;
}

async function jsonRequest(fetchImpl, url, init, timeoutMs, kind) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new EmailWorkerError(`${kind}_unavailable`, { retryable: true });
  }
  let payload = null;
  const raw = await response.text();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      if (response.ok) throw new EmailWorkerError(`${kind}_invalid_response`, { retryable: true });
    }
  }
  if (!response.ok) {
    const status = Number(response.status);
    throw new EmailWorkerError(`${kind}_http_${status}`, {
      status,
      retryAfterMs: retryAfterMs(response.headers),
      retryable: status === 408 || status === 425 || status === 429 || status >= 500,
    });
  }
  return payload;
}

function safeFilter(value) {
  return `eq.${value}`;
}

export function createEmailDispatcher(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => Date.now());
  const log = dependencies.log ?? (() => undefined);

  async function supabase(path, init = {}) {
    return jsonRequest(
      fetchImpl,
      new URL(path, `${config.supabaseUrl}/`),
      {
        ...init,
        headers: {
          apikey: config.supabaseServiceKey,
          authorization: `Bearer ${config.supabaseServiceKey}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      },
      config.requestTimeoutMs,
      "supabase",
    );
  }

  async function rpc(name, args) {
    return supabase(`rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  async function queryLog(messageId) {
    const url = new URL("rest/v1/email_send_log", `${config.supabaseUrl}/`);
    url.searchParams.set("select", "id,status");
    url.searchParams.set("message_id", safeFilter(messageId));
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "1");
    const rows = await supabase(url, { method: "GET" });
    return Array.isArray(rows) ? (rows[0] ?? null) : null;
  }

  async function updateLog(logId, patch) {
    const url = new URL("rest/v1/email_send_log", `${config.supabaseUrl}/`);
    url.searchParams.set("id", safeFilter(logId));
    await supabase(url, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
  }

  async function suppressed(email) {
    const url = new URL("rest/v1/suppressed_emails", `${config.supabaseUrl}/`);
    url.searchParams.set("select", "id");
    url.searchParams.set("email", safeFilter(email));
    url.searchParams.set("limit", "1");
    const rows = await supabase(url, { method: "GET" });
    return Array.isArray(rows) && rows.length > 0;
  }

  async function removeMessage(queueName, messageId) {
    const deleted = await rpc("delete_email", {
      queue_name: queueName,
      message_id: messageId,
    });
    if (deleted !== true) {
      throw new EmailWorkerError("email_queue_delete_failed", { retryable: true });
    }
  }

  async function deadLetter(queueName, row, logId, reason) {
    await rpc("move_to_dlq", {
      source_queue: queueName,
      dlq_name: `${queueName}_dlq`,
      message_id: row.msg_id,
      payload: row.message,
    });
    if (logId) {
      await updateLog(logId, {
        status: "dlq",
        error_message: reason,
        metadata: {
          terminal_reason: reason,
          attempts: row.read_ct,
          dead_lettered_at: new Date(now()).toISOString(),
        },
      });
    }
    log("warn", "email_dead_lettered", {
      queue: queueName,
      message_id: String(row.msg_id),
      error_code: reason,
    });
    return { status: "dead_lettered", retryAfterMs: 0 };
  }

  async function send(message) {
    const headers = {};
    if (message.purpose === "transactional" && message.unsubscribeToken) {
      const unsubscribe = new URL("/email/unsubscribe", config.publicOrigin);
      unsubscribe.searchParams.set("token", message.unsubscribeToken);
      headers["List-Unsubscribe"] = `<${unsubscribe.toString()}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const payload = {
      from: message.from,
      to: message.to,
      subject: message.subject,
      ...(message.html ? { html: message.html } : {}),
      ...(message.text ? { text: message.text } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
    const result = await jsonRequest(
      fetchImpl,
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.resendApiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
        },
        body: JSON.stringify(payload),
      },
      config.requestTimeoutMs,
      "resend",
    );
    if (!result || typeof result.id !== "string" || !SAFE_MESSAGE_ID.test(result.id)) {
      throw new EmailWorkerError("resend_invalid_response", { retryable: true });
    }
    return result.id;
  }

  async function processRow(queueName, row) {
    if (
      !row ||
      !Number.isSafeInteger(row.msg_id) ||
      !Number.isSafeInteger(row.read_ct) ||
      row.read_ct < 1
    ) {
      throw new EmailWorkerError("invalid_queue_row");
    }

    let message;
    let safeMessageId = null;
    try {
      message = parseEmailQueueMessage(row.message, config, now());
      safeMessageId = message.messageId;
    } catch (error) {
      const code = error instanceof EmailWorkerError ? error.code : "invalid_email_payload";
      const possibleId = row.message?.message_id;
      const logRow =
        typeof possibleId === "string" && SAFE_MESSAGE_ID.test(possibleId)
          ? await queryLog(possibleId)
          : null;
      return deadLetter(queueName, row, logRow?.id ?? null, code);
    }

    const logRow = await queryLog(message.messageId);
    if (!logRow || typeof logRow.id !== "string") {
      return deadLetter(queueName, row, null, "email_log_missing");
    }
    if (TERMINAL_LOG_STATUSES.has(logRow.status)) {
      await removeMessage(queueName, row.msg_id);
      log("info", "email_queue_reconciled", {
        queue: queueName,
        message_id: String(row.msg_id),
      });
      return { status: "already_complete", retryAfterMs: 0 };
    }
    if (await suppressed(message.to)) {
      await updateLog(logRow.id, {
        status: "suppressed",
        error_message: "recipient_suppressed",
        metadata: { suppressed_at: new Date(now()).toISOString() },
      });
      await removeMessage(queueName, row.msg_id);
      log("info", "email_suppressed", {
        queue: queueName,
        message_id: String(row.msg_id),
      });
      return { status: "suppressed", retryAfterMs: 0 };
    }

    try {
      const providerId = await send(message);
      await updateLog(logRow.id, {
        status: "sent",
        error_message: null,
        metadata: {
          provider: "resend",
          provider_id: providerId,
          sent_at: new Date(now()).toISOString(),
        },
      });
      await removeMessage(queueName, row.msg_id);
      log("info", "email_sent", {
        queue: queueName,
        message_id: String(row.msg_id),
        provider_id: providerId,
      });
      return { status: "sent", retryAfterMs: 0 };
    } catch (error) {
      const failure =
        error instanceof EmailWorkerError
          ? error
          : new EmailWorkerError("email_send_failed", { retryable: true });
      const exhausted = row.read_ct >= config.maxAttempts;
      if (!failure.retryable || exhausted) {
        return deadLetter(queueName, row, logRow.id, failure.code);
      }
      await updateLog(logRow.id, {
        status: "pending",
        error_message: failure.code,
        metadata: {
          attempts: row.read_ct,
          retry_after_ms: failure.retryAfterMs,
          last_attempt_at: new Date(now()).toISOString(),
        },
      });
      log("warn", "email_retry_scheduled", {
        queue: queueName,
        message_id: String(row.msg_id),
        error_code: failure.code,
        attempt: row.read_ct,
      });
      return { status: "retrying", retryAfterMs: failure.retryAfterMs };
    }
  }

  async function mapLimit(rows, task) {
    const results = new Array(rows.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(config.concurrency, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(rows[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function readQueue(queueName) {
    const rows = await rpc("read_email_batch", {
      queue_name: queueName,
      batch_size: config.batchSize,
      vt: config.visibilityTimeoutSeconds,
    });
    if (!Array.isArray(rows)) {
      throw new EmailWorkerError("invalid_email_queue_response", { retryable: true });
    }
    return mapLimit(rows, (row) => processRow(queueName, row));
  }

  return Object.freeze({
    async pollOnce() {
      const settled = await Promise.allSettled(QUEUES.map((queueName) => readQueue(queueName)));
      const results = [];
      let failed = false;
      for (const item of settled) {
        if (item.status === "fulfilled") results.push(...item.value);
        else failed = true;
      }
      if (failed) {
        throw new EmailWorkerError("email_queue_poll_failed", { retryable: true });
      }
      const report = {
        processed: results.length,
        sent: results.filter((item) => item.status === "sent").length,
        suppressed: results.filter((item) => item.status === "suppressed").length,
        alreadyComplete: results.filter((item) => item.status === "already_complete").length,
        retrying: results.filter((item) => item.status === "retrying").length,
        deadLettered: results.filter((item) => item.status === "dead_lettered").length,
        retryAfterMs: results.reduce(
          (maximum, item) => Math.max(maximum, item.retryAfterMs ?? 0),
          0,
        ),
      };
      return Object.freeze(report);
    },
  });
}
