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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Subscription = {
  ownerId: string;
  topic: string;
  bind: (channel: RealtimeChannel, invalidate: () => void) => void;
  invalidate: () => void;
  onStatus: (status: string) => void;
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
  let removeObserver = () => {};
  const lifetime = new AbortController();
  const current = () => active && isKovaSessionActive() && generation === kovaAuthGeneration();

  const stop = (denied = false) => {
    if (!active) return;
    active = false;
    token = null;
    deadline = 0;
    clearTimeout(leaseTimer);
    clearTimeout(refreshTimer);
    removeObserver();
    lifetime.abort();
    // Do not wait for the server to acknowledge unsubscribe before stopping
    // delivery or disconnecting. Teardown also clears channel rejoin timers.
    try {
      if (channel) {
        void channel.unsubscribe(1000).catch(() => {});
        channel.teardown();
      }
    } finally {
      if (client) void client.disconnect().catch(() => {});
    }
    if (denied) options.onStatus("CHANNEL_ERROR");
  };
  const admitted = () => {
    if (!current() || performance.now() >= deadline || Date.now() >= expiresAt) {
      stop(true);
      return false;
    }
    return true;
  };
  removeObserver = subscribeKovaAuthChanges(() => stop(true));

  const refresh = async (): Promise<string | null> => {
    if (!current()) {
      stop(true);
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
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (controller.signal.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("realtime_lease_unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("realtime_lease_unavailable");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const cancelReader = () => {
        void reader.cancel().catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new Error("realtime_lease_unavailable");
          if (done) break;
          size += value.byteLength;
          if (size > MAX_REPLY_BYTES) throw new Error("realtime_lease_unavailable");
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
      const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const next = payload?.session as KovaBrowserPrincipal | undefined;
      const expiry = typeof next?.expiresAt === "string" ? Date.parse(next.expiresAt) : NaN;
      if (
        !next ||
        !UUID.test(options.ownerId) ||
        next.accountId !== options.ownerId ||
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
        payload.expiresIn > 300 ||
        (principal &&
          (next.sessionId !== principal.sessionId ||
            next.email !== principal.email ||
            next.assuranceLevel !== principal.assuranceLevel))
      )
        throw new Error("realtime_lease_unavailable");
      // Both the token and the public principal are made from the same live
      // session by the same-origin endpoint. No browser-supplied claim is used.
      return { next, expiry, accessToken: payload.accessToken as string };
    };
    renewal = (async () => {
      try {
        const value = await Promise.race([read(), cancelled]);
        if (!current() || controller.signal.aborted || performance.now() >= started + LEASE_MS) {
          stop(true);
          return null;
        }
        principal = value.next;
        expiresAt = value.expiry;
        token = value.accessToken;
        deadline = Math.min(started + LEASE_MS, performance.now() + expiresAt - Date.now());
        refreshAt = Math.min(started + RECHECK_MS, deadline);
        clearTimeout(leaseTimer);
        clearTimeout(refreshTimer);
        leaseTimer = setTimeout(() => stop(true), Math.max(0, deadline - performance.now()));
        refreshTimer = setTimeout(
          () => {
            if (!current()) {
              stop(true);
              return;
            }
            void client?.setAuth().catch(() => stop(true));
          },
          Math.max(0, refreshAt - performance.now()),
        );
        return token;
      } catch {
        // The SDK retains its previous token when its callback throws. Return
        // null and tear down instead, so a rejected lease cannot reuse it.
        stop(true);
        return null;
      } finally {
        clearTimeout(timeout);
        lifetime.signal.removeEventListener("abort", abort);
        renewal = null;
      }
    })();
    return renewal;
  };

  void (async () => {
    try {
      const firstToken = await refresh();
      if (!firstToken || !admitted()) return;
      const { url, publishableKey } = SUPABASE_BROWSER_CONFIG;
      if (!url || !publishableKey) {
        stop(true);
        return;
      }
      client = new RealtimeClient(`${url.replace(/\/$/u, "")}/realtime/v1`, {
        params: { apikey: publishableKey },
        accessToken: refresh,
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
    } catch {
      stop(true);
    }
  })();
  return () => stop();
}
