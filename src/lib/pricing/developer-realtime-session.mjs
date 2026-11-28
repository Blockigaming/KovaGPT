import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createBrowserChannel } from "./developer-browser-interactive.mjs";
import { developerBrowserFields } from "./developer-browser-policy.mjs";
import { developerRealtimeFields } from "./developer-realtime-policy.mjs";
import { developerRequestKey, developerUuid } from "./developer-platform-policy.mjs";

export const REALTIME_SOCKET_PATH = "/api/developer/realtime/socket";
export const REALTIME_SOCKET_PROTOCOL = "kova.realtime.v1";
const TOKEN = /^krt_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/;
const fail = (code = "developer_realtime_invalid") => {
  throw new Error(code);
};
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const exact = (v, keys) => record(v) && Object.keys(v).sort().join() === [...keys].sort().join();
export function realtimeOrigin(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 512) fail();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) fail();
    return url.origin;
  } catch {
    fail();
  }
}
export function realtimeGrant() {
  const id = randomUUID(),
    secret = randomBytes(32).toString("base64url");
  return {
    id,
    token: `krt_${id}_${secret}`,
    digest: createHash("sha256").update(secret).digest("hex"),
  };
}
export function parseRealtimeGrant(value) {
  const match = typeof value === "string" && TOKEN.exec(value);
  if (!match) fail("developer_realtime_unauthorized");
  return {
    id: developerUuid(match[1]),
    digest: createHash("sha256").update(match[2]).digest("hex"),
  };
}
export function parseRealtimeSessionRequest(method, params, input) {
  if (method === "POST") {
    if ([...params].length || !record(input) || Object.keys(input).some((k) => k !== "origin"))
      fail();
    return { operation: "issue", origin: realtimeOrigin(input.origin) };
  }
  if (!["GET", "DELETE"].includes(method) || [...params].length !== 1 || !params.has("id")) fail();
  return { operation: method === "GET" ? "get" : "close", id: developerUuid(params.get("id")) };
}
function message(value, kind) {
  const validateInput = (input) => {
    if (kind === "browser") {
      if (
        input?.interactive !== true ||
        !input.model ||
        Object.keys(input).some((k) => !["model", "url", "interactive"].includes(k))
      )
        fail();
      developerBrowserFields(input);
    } else developerRealtimeFields(input);
  };
  if (typeof value !== "string" || Buffer.byteLength(value) > 350000) fail();
  let v;
  try {
    v = JSON.parse(value);
  } catch {
    fail();
  }
  if (v?.type === "session.authenticate" && exact(v, ["type", "token"])) {
    return { type: v.type, ...parseRealtimeGrant(v.token) };
  }
  if (v?.type === "session.close" && exact(v, ["type"])) return v;
  if (v?.type === "turn.cancel" && exact(v, ["type", "id"]))
    return { type: v.type, id: developerUuid(v.id) };
  if (kind === "browser" && v?.type === "turn.action" && exact(v, ["type", "id", "command"]))
    return { type: v.type, id: developerUuid(v.id), command: v.command };
  if (v?.type === "turn.quote" && exact(v, ["type", "id", "input"])) {
    validateInput(v.input);
    return { type: v.type, id: developerUuid(v.id), input: v.input };
  }
  if (
    v?.type === "turn.create" &&
    exact(v, ["type", "id", "input", "quote_token", "request_key"])
  ) {
    validateInput(v.input);
    if (
      typeof v.quote_token !== "string" ||
      !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(v.quote_token) ||
      v.quote_token.length > 2048 ||
      String(v.request_key).startsWith("batch:")
    )
      fail();
    return {
      type: v.type,
      id: developerUuid(v.id),
      input: v.input,
      quote_token: v.quote_token,
      request_key: developerRequestKey(v.request_key),
    };
  }
  fail();
}

/** An authenticated connection, exactly one in-flight turn and no automatic dispatch.
 * A database grant controls redemption, expiry, ownership, revocation and turn count.
 * The transport itself never receives a provider or developer API key. */
export function createRealtimeConnection({
  kind = "realtime",
  send,
  close,
  claim,
  check,
  quote,
  begin,
  execute,
  finish,
  disconnect,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setTicker = setInterval,
  clearTicker = clearInterval,
}) {
  const connection = randomUUID();
  let state = "awaiting",
    grant,
    active,
    quotes = 0,
    actionAttempts = 0,
    timer,
    ticker,
    checking = false;
  const emit = (v) => {
    if (state !== "closed") send(v);
  };
  const cleanup = () => {
    clearTimer(timer);
    clearTicker(ticker);
    active?.controller.abort();
  };
  async function stop(code = 1000, reason = "session_closed") {
    if (state === "closed") return;
    state = "closed";
    cleanup();
    try {
      close(code, reason);
    } catch {
      /* peer already gone */
    }
    if (grant) await disconnect(grant.id, connection).catch(() => {});
  }
  async function heartbeat() {
    if (checking || state !== "connected") return;
    checking = true;
    try {
      if (now() >= grant.expiresAt) throw Error("expired");
      await check(grant.id, connection);
    } catch {
      await stop(1008, "session_unavailable");
    } finally {
      checking = false;
    }
  }
  timer = setTimer(() => void stop(1008, "authentication_required"), 5000);
  timer.unref?.();
  async function receive(raw) {
    if (state === "closed") return;
    let v;
    try {
      v = message(raw, kind);
    } catch {
      await stop(1008, "invalid_message");
      return;
    }
    if (state === "awaiting") {
      if (v.type !== "session.authenticate") {
        await stop(1008, "authentication_required");
        return;
      }
      state = "authenticating";
      try {
        const claimed = await claim(v.id, v.digest, connection);
        if (state === "closed") {
          await disconnect(v.id, connection).catch(() => {});
          return;
        }
        if (
          claimed.id !== v.id ||
          !Number.isFinite(claimed.expiresAt) ||
          claimed.expiresAt <= now() ||
          claimed.expiresAt > now() + 300000 + 10000
        ) {
          await disconnect(v.id, connection).catch(() => {});
          throw Error("invalid_grant");
        }
        grant = claimed;
        state = "connected";
        clearTimer(timer);
        timer = setTimer(
          () => void stop(1008, "session_expired"),
          Math.max(0, grant.expiresAt - now()),
        );
        ticker = setTicker(() => void heartbeat(), 2000);
        timer.unref?.();
        ticker.unref?.();
        emit({
          type: "session.ready",
          id: grant.id,
          expires_at: grant.expiresAt,
          maximum_turns: kind === "browser" ? 1 : 8,
        });
      } catch {
        await stop(1008, "authentication_failed");
      }
      return;
    }
    if (state !== "connected") {
      await stop(1008, "authentication_required");
      return;
    }
    if (now() >= grant.expiresAt) {
      await stop(1008, "session_expired");
      return;
    }
    if (v.type === "session.close") {
      await stop();
      return;
    }
    if (v.type === "turn.cancel") {
      if (active?.id === v.id) {
        active.controller.abort();
        emit({ type: "turn.cancel_requested", id: v.id });
      } else emit({ type: "error", id: v.id, code: "developer_realtime_not_found" });
      return;
    }
    if (v.type === "turn.action") {
      if (++actionAttempts > 32) {
        await stop(1008, "action_limit");
        return;
      }
      try {
        if (!active?.channel || active.id !== v.id) fail("developer_browser_conflict");
        const identity = await check(grant.id, connection);
        if (active?.id !== v.id) fail("developer_browser_conflict");
        active.channel.accept(v.command, identity.capabilities.includes("computer_use"));
        emit({ type: "turn.action_accepted", id: v.id });
      } catch (error) {
        emit({
          type: "turn.action_rejected",
          id: v.id,
          code: /^developer_[a-z_]+$/.test(error?.message ?? "")
            ? error.message
            : "developer_browser_unavailable",
        });
      }
      return;
    }
    if (v.type === "session.authenticate") {
      await stop(1008, "already_authenticated");
      return;
    }
    if (active) {
      emit({ type: "error", id: v.id, code: "developer_realtime_conflict" });
      return;
    }
    const job = { id: v.id, controller: new AbortController(), started: false };
    active = job;
    try {
      const identity = await check(grant.id, connection);
      job.controller.signal.throwIfAborted();
      if (v.type === "turn.quote") {
        if (++quotes > 16) throw Error("developer_rate_limit");
        const price = await quote(identity, v.input);
        job.controller.signal.throwIfAborted();
        emit({ type: "turn.quoted", id: v.id, quote: price });
      } else {
        const turn = await begin(grant.id, connection, v.id);
        job.started = true;
        job.controller.signal.throwIfAborted();
        emit({ type: "turn.started", id: v.id });
        if (kind === "browser")
          job.channel = createBrowserChannel(
            (delta) => emit({ type: "turn.delta", id: v.id, ...delta }),
            job.controller.signal,
          );
        const result = await execute(
          turn,
          v.input,
          v.request_key,
          v.quote_token,
          job.controller.signal,
          (delta) => {
            job.controller.signal.throwIfAborted();
            emit({ type: "turn.delta", id: v.id, ...delta });
          },
          job.channel,
        );
        job.controller.signal.throwIfAborted();
        await finish(grant.id, connection, v.id);
        job.started = false;
        emit({ type: "turn.completed", id: v.id, result });
      }
    } catch (error) {
      if (job.started) {
        try {
          await finish(grant.id, connection, v.id);
        } catch {
          await stop(1008, "session_unavailable");
        }
      }
      if (state !== "closed")
        emit({
          type: job.controller.signal.aborted ? "turn.cancelled" : "error",
          id: v.id,
          code: job.controller.signal.aborted
            ? "developer_realtime_cancelled"
            : /^developer_[a-z_]+$/.test(error?.message ?? "")
              ? error.message
              : "developer_realtime_unavailable",
          request_may_have_started: job.started || v.type === "turn.create",
        });
    } finally {
      job.channel?.close();
      if (active === job) active = undefined;
    }
  }
  return {
    receive,
    stop,
    heartbeat,
    get state() {
      return state;
    },
  };
}
