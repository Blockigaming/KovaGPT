import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { RealtimeClient } from "@supabase/supabase-js";
import { WebSocket } from "undici";
import { SUPABASE } from "./s6-deployed-checks.mjs";

// Replaced by the bundler with the exact production lifecycle module, compiled
// without changing constants or transport behavior. Only browser state/cookie
// plumbing is supplied by this command-line fixture.
const lifecycleSource = typeof S6_REALTIME_SOURCE === "undefined" ? null : S6_REALTIME_SOURCE;
export function loadRealtimeLifecycle(source, context) {
  const module = { exports: {} };
  vm.runInNewContext(source, { ...context, module, exports: module.exports });
  assert.equal(typeof module.exports.subscribeOwnedRealtime, "function");
  return module.exports;
}
const wait = async (predicate, milliseconds = 25000) => {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("realtime_condition_timeout");
};
export async function realtimeProbe(run) {
  assert.ok(lifecycleSource, "realtime probe must be built from the production module");
  const f = await run.signup("realtime");
  const owner = f.principal.accountId;
  const events = { messages: 0, denied: 0, closed: 0, subscribed: 0 };
  let currentCookie = f.cookie;
  const db = run.db;
  // This dedicated table contains only synthetic test payloads. It is removed
  // in finally; the production publication and other tables are unchanged.
  db.query(`begin;create table public.kova_s6_realtime(id uuid primary key,owner_id uuid not null,payload text not null);
    alter table public.kova_s6_realtime enable row level security;
    grant select on public.kova_s6_realtime to authenticated;
    create policy owner_read on public.kova_s6_realtime for select to authenticated using(owner_id=auth.uid());
    create policy live_session on public.kova_s6_realtime as restrictive for select to authenticated using(kova_auth_guard.session_is_active());
    alter publication supabase_realtime add table public.kova_s6_realtime;commit;`);
  let stop;
  try {
    class Socket extends WebSocket {
      constructor(url, protocols) {
        super(url, { protocols, dispatcher: run.dispatcher });
        this.addEventListener("close", () => events.closed++);
      }
    }
    class Client extends RealtimeClient {
      constructor(url, options) {
        super(url, { ...options, transport: Socket, timeout: 10000, heartbeatIntervalMs: 10000 });
      }
    }
    const lifecycle = loadRealtimeLifecycle(lifecycleSource, {
      Request,
      Response,
      Headers,
      URL,
      TextDecoder,
      Uint8Array,
      AbortController,
      Date,
      performance,
      setTimeout,
      clearTimeout,
      console: { warn() {}, error() {} },
      fetch: async (path, init) => {
        assert.equal(path, "/api/auth/token");
        const r = await run.app(path, { cookie: currentCookie, headers: init.headers });
        return new Response(r.text, { status: r.status, headers: r.headers });
      },
      require: (name) => {
        if (name === "@supabase/supabase-js") return { RealtimeClient: Client };
        if (name === "@/integrations/supabase/config")
          return { SUPABASE_BROWSER_CONFIG: { url: SUPABASE, publishableKey: run.apiKey } };
        if (name === "./kova-auth-browser")
          return {
            isKovaSessionActive: () => true,
            kovaAuthGeneration: () => 0,
            subscribeKovaAuthChanges: () => () => {},
          };
        assert.fail("unexpected_realtime_dependency");
      },
    });
    const subscribe = () =>
      lifecycle.subscribeOwnedRealtime({
        ownerId: owner,
        topic: "kova-collaboration:s6-" + run.runId,
        bind: (channel, invalidate) =>
          channel.on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "kova_s6_realtime",
              filter: "owner_id=eq." + owner,
            },
            invalidate,
          ),
        invalidate: () => events.messages++,
        onStatus: (s) => {
          if (s === "SUBSCRIBED") events.subscribed++;
        },
        onDenied: () => events.denied++,
      });
    const insert = () =>
      db.query(
        `insert into public.kova_s6_realtime values('${randomUUID()}','${owner}','synthetic')`,
      );
    stop = subscribe();
    await wait(() => events.subscribed === 1);
    insert();
    await wait(() => events.messages === 1);
    const revoked = f.cookie;
    const logout = await run.app("/api/auth/logout", {
      method: "POST",
      body: {},
      cookie: revoked,
      principal: f.principal,
    });
    assert.equal(logout.status, 204);
    insert();
    await wait(() => events.denied === 1, 22000);
    await wait(() => events.closed > 0, 5000);
    const delivered = events.messages;
    assert.equal(delivered, 1, "event after committed revocation leaked");
    insert();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(events.messages, delivered);
    stop();
    stop = subscribe();
    await wait(() => events.denied === 2, 8000);
    assert.equal(events.subscribed, 1, "revoked reconnect subscribed");
    stop();
    await run.login(f);
    currentCookie = f.cookie;
    stop = subscribe();
    await wait(() => events.subscribed === 2);
    insert();
    await wait(() => events.messages === 2);
    run.note("realtime_reauthorization", [
      "real WebSocket and owner event delivered",
      "committed revocation blocks new row events",
      "production 15-second lease recheck denies token and closes socket",
      "revoked reconnect rejected",
      "fresh owned authority receives events",
    ]);
  } finally {
    stop?.();
    db.query("drop table public.kova_s6_realtime;");
  }
}
