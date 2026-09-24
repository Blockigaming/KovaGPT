import { RealtimeClient, type RealtimeChannel } from "@supabase/supabase-js";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";
import {
  isKovaSessionActive,
  kovaAuthGeneration,
  subscribeKovaAuthChanges,
  type KovaBrowserPrincipal,
} from "./kova-auth-browser";

// These are client delivery leases, not a claim of instantaneous remote socket
// revocation. The database RLS/session guard remains the authorization boundary.
const LEASE_MS = 30_000;
const RECHECK_MS = 15_000;
const REQUEST_MS = 5_000;
const MAX_REPLY_BYTES = 16_384;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type LeaseFailureKind = "denied" | "transient" | "invalid";

class LeaseFailure extends Error {
  constructor(readonly kind: LeaseFailureKind) {
    super("realtime_lease_unavailable");
  }
}

type Subscription = {
  ownerId: string;
  topic: string;
  bind: (channel: RealtimeChannel, invalidate: () => void) => void;
  invalidate: () => void;
  onStatus: (status: string) => void;
  onDenied?: () => void;
};

/** A dedicated socket cannot carry another account's channels after a switch. */
export function subscribeOwnedRealtime(options: Subscription): () => void {
  const generation = kovaAuthGeneration();
  let active = true;
  let client: RealtimeClient | undefined;
  let channel: RealtimeChannel | undefined;
  let principal: KovaBrowserPrincipal | undefined;
  let token: string | null = null;
  let deadline = 0;
  let refreshAt = 0;
  let expiresAt = 0;
  let renewal: Promise<string | null> | null = null;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryCount = 0;
  let removeObserver = () => {};
  const lifetime = new AbortController();
  const current = () => active && isKovaSessionActive() && generation === kovaAuthGeneration();

  const closeTransport = () => {
    token = null;
    deadline = 0;
    refreshAt = 0;
    expiresAt = 0;
    clearTimeout(leaseTimer);
    clearTimeout(refreshTimer);
    const closingChannel = channel;
    const closingClient = client;
    channel = undefined;
    client = undefined;
    try {
      if (closingChannel) {
        void closingChannel.unsubscribe(1000).catch(() => {});
        closingChannel.teardown();
      }
    } finally {
      if (closingClient) void closingClient.disconnect().catch(() => {});
    }
  };
  const stop = (denied = false) => {
    if (!active) return;
    active = false;
    clearTimeout(retryTimer);
    removeObserver();
    lifetime.abort();
    closeTransport();
    if (denied) {
      options.onStatus("CHANNEL_ERROR");
      options.onDenied?.();
    }
  };
  const scheduleRetry = () => {
    if (!active) return;
    if (!current()) {
      stop();
      return;
    }
    closeTransport();
    options.onStatus("CHANNEL_ERROR");
    if (retryCount >= MAX_RETRIES) {
      stop();
      return;
    }
    const delay = RETRY_BASE_MS * 2 ** retryCount;
    retryCount += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!current()) {
        stop();
        return;
      }
      void connect();
    }, delay);
  };
  const handleFailure = (error: unknown) => {
    if (error instanceof LeaseFailure) {
      if (error.kind === "denied") {
        stop(true);
        return;
      }
      if (error.kind === "invalid") {
        options.onStatus("CHANNEL_ERROR");
        stop();
        return;
      }
    }
    scheduleRetry();
  };
  const admitted = () => {
    if (!current()) {
      stop();
      return false;
    }
    if (performance.now() >= deadline || Date.now() >= expiresAt) {
      scheduleRetry();
      return false;
    }
    return true;
  };
  removeObserver = subscribeKovaAuthChanges(() => stop());

  const refresh = async (): Promise<string | null> => {
    if (!current()) {
      stop();
      return null;
    }
    if (token && performance.now() < refreshAt && admitted()) return token;
    if (renewal) return renewal;
    const started = performance.now();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error("realtime_lease_unavailable"));
      };
      lifetime.signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(abort, REQUEST_MS);
    });
    const read = async () => {
      const response = await fetch("/api/auth/token", {
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "X-Kova-Owner": options.ownerId,
          ...(principal ? { "X-Kova-Session": principal.sessionId } : {}),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new LeaseFailure("transient");
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if ([401, 403, 409].includes(response.status)) throw new LeaseFailure("denied");
        if (response.status >= 500 || response.status === 408 || response.status === 429)
          throw new LeaseFailure("transient");
        throw new LeaseFailure("invalid");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new LeaseFailure("invalid");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const cancelReader = () => {
        void reader.cancel().catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new LeaseFailure("transient");
          if (done) break;
          size += value.byteLength;
          if (size > MAX_REPLY_BYTES) throw new LeaseFailure("invalid");
          chunks.push(value);
        }
      } catch (error) {
        cancelReader();
        throw error;
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let payload: {
        session?: KovaBrowserPrincipal;
        accessToken?: unknown;
        expiresIn?: unknown;
      };
      try {
        payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new LeaseFailure("invalid");
      }
      const next = payload?.session;
      const expiry = typeof next?.expiresAt === "string" ? Date.parse(next.expiresAt) : NaN;
      if (
        next &&
        (next.accountId !== options.ownerId ||
          (principal &&
            (next.sessionId !== principal.sessionId ||
              next.email !== principal.email ||
              next.assuranceLevel !== principal.assuranceLevel)))
      )
        throw new LeaseFailure("denied");
      if (
        !next ||
        !UUID.test(options.ownerId) ||
        typeof next.sessionId !== "string" ||
        !UUID.test(next.sessionId) ||
        next.emailVerified !== true ||
        typeof next.email !== "string" ||
        !next.email ||
        !["aal1", "aal2"].includes(next.assuranceLevel) ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        typeof payload.accessToken !== "string" ||
        payload.accessToken.length > MAX_REPLY_BYTES ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(payload.accessToken) ||
        !Number.isSafeInteger(payload.expiresIn) ||
        payload.expiresIn < 60 ||
        payload.expiresIn > 300
      )
        throw new LeaseFailure("invalid");
      // Both the token and the public principal are made from the same live
      // session by the same-origin endpoint. No browser-supplied claim is used.
      return { next, expiry, accessToken: payload.accessToken as string };
    };
    renewal = (async () => {
      try {
        const value = await Promise.race([read(), cancelled]);
        if (!current()) {
          stop();
          return null;
        }
        if (controller.signal.aborted || performance.now() >= started + LEASE_MS) {
          throw new LeaseFailure("transient");
        }
        principal = value.next;
        expiresAt = value.expiry;
        token = value.accessToken;
        deadline = Math.min(started + LEASE_MS, performance.now() + expiresAt - Date.now());
        refreshAt = Math.min(started + RECHECK_MS, deadline);
        clearTimeout(leaseTimer);
        clearTimeout(refreshTimer);
        retryCount = 0;
        leaseTimer = setTimeout(
          () => {
            scheduleRetry();
          },
          Math.max(0, deadline - performance.now()),
        );
        refreshTimer = setTimeout(() => void renew(), Math.max(0, refreshAt - performance.now()));
        return token;
      } finally {
        clearTimeout(timeout);
        lifetime.signal.removeEventListener("abort", abort);
        renewal = null;
      }
    })();
    return renewal;
  };

  async function renew() {
    try {
      const next = await refresh();
      if (!next || !current()) return;
      await client?.setAuth(next);
    } catch (error) {
      handleFailure(error);
    }
  }

  async function connect() {
    if (!current()) {
      stop();
      return;
    }
    try {
      const firstToken = await refresh();
      if (!firstToken || !admitted()) return;
      const { url, publishableKey } = SUPABASE_BROWSER_CONFIG;
      if (!url || !publishableKey) {
        stop();
        return;
      }
      client = new RealtimeClient(`${url.replace(/\/$/u, "")}/realtime/v1`, {
        params: { apikey: publishableKey },
        accessToken: async () => {
          try {
            return await refresh();
          } catch (error) {
            handleFailure(error);
            throw error;
          }
        },
        heartbeatIntervalMs: RECHECK_MS,
      });
      await client.setAuth(firstToken);
      if (!admitted()) return;
      channel = client.channel(options.topic);
      options.bind(channel, () => {
        if (admitted()) options.invalidate();
      });
      channel.subscribe((status) => {
        if (admitted()) options.onStatus(status);
      });
      retryCount = 0;
    } catch (error) {
      handleFailure(error);
    }
  }

  void connect();
  return () => stop();
}
