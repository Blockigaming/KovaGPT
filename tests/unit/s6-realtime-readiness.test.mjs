import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { RealtimeClient } from "@supabase/supabase-js";
import { WebSocket, Agent } from "undici";
import { WebSocketServer } from "ws";
import {
  loadRealtimeLifecycle,
  postgresReadiness,
} from "../../scripts/release/s6-realtime-probe.mjs";

// Loopback only: exact production lifecycle + installed SDK; no staging writes,
// no shortened auth lease, no hosted or owned revocation acceptance rerun.
test("real SDK reproduces join-before-replication loss and new readiness gate prevents it on both connections", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port,
    dispatcher = new Agent();
  const events = { postgresReady: 0, postgresErrors: 0, messages: 0, subscribed: 0 };
  let connection,
    stop,
    readiness,
    writesBeforeReady = 0;
  const bounded = async (name, predicate) => {
    const deadline = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(predicate(), true, name);
  };
  const send = (event, payload) =>
    connection.send(JSON.stringify([connection.joinRef, null, connection.topic, event, payload]));
  server.on("connection", (socket) => {
    connection = socket;
    socket.replicationReady = false;
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message[3] === "phx_join") {
        socket.topic = message[2];
        socket.joinRef = message[0];
        socket.send(
          JSON.stringify([
            message[0],
            message[1],
            message[2],
            "phx_reply",
            {
              status: "ok",
              response: {
                postgres_changes: [{ id: 1, event: "INSERT", schema: "public", table: "fixture" }],
              },
            },
          ]),
        );
      }
    });
  });
  const owner = "10000000-0000-4000-8000-000000000001";
  const payload = {
    accessToken:
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(
        JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 300 }),
      ).toString("base64url") +
      ".c2ln",
    expiresIn: 300,
    session: {
      accountId: owner,
      sessionId: "20000000-0000-4000-8000-000000000002",
      email: "fixture@example.invalid",
      emailVerified: true,
      assuranceLevel: "aal1",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  };
  class Socket extends WebSocket {
    constructor(url, protocols) {
      super(url, { protocols, dispatcher });
    }
  }
  class Client extends RealtimeClient {
    constructor(_url, options) {
      super(`http://127.0.0.1:${port}/realtime/v1`, {
        ...options,
        transport: Socket,
        timeout: 1000,
      });
    }
  }
  const lifecycle = loadRealtimeLifecycle(
    transformSync(readFileSync("src/lib/kova-auth-realtime.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
      target: "node22",
    }).code,
    {
      Response,
      Request,
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
      fetch: async () => Response.json(payload),
      require: (name) => {
        if (name === "@supabase/supabase-js") return { RealtimeClient: Client };
        if (name === "@/integrations/supabase/config")
          return {
            SUPABASE_BROWSER_CONFIG: { url: `http://127.0.0.1:${port}`, publishableKey: "fixture" },
          };
        if (name === "./kova-auth-browser")
          return {
            isKovaSessionActive: () => true,
            kovaAuthGeneration: () => 0,
            subscribeKovaAuthChanges: () => () => {},
          };
        assert.fail("unexpected dependency");
      },
    },
  );
  const subscribe = () => {
    readiness = postgresReadiness(events);
    return lifecycle.subscribeOwnedRealtime({
      ownerId: owner,
      topic: "kova-collaboration:s6-readiness",
      bind: (channel, invalidate) =>
        readiness
          .bind(channel)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "fixture" },
            invalidate,
          ),
      invalidate: () => events.messages++,
      onStatus: (status) => {
        if (status === "SUBSCRIBED") events.subscribed++;
      },
      onDenied: () => assert.fail("unexpected authority denial"),
    });
  };
  const insert = () => {
    if (!connection.replicationReady) {
      writesBeforeReady++;
      return;
    }
    send("postgres_changes", {
      ids: [1],
      data: {
        schema: "public",
        table: "fixture",
        commit_timestamp: new Date().toISOString(),
        type: "INSERT",
        columns: [{ name: "id", type: "uuid" }],
        record: { id: owner },
        old_record: {},
      },
    });
  };
  try {
    for (const generation of [1, 2]) {
      stop = subscribe();
      await bounded("channel joined", () => events.subscribed === generation);
      assert.equal(events.postgresReady, generation - 1, "fresh channel cannot inherit readiness");
      if (generation === 1) {
        insert();
        assert.equal(writesBeforeReady, 1);
        assert.equal(events.messages, 0);
      }
      const run = {};
      let ready = false;
      const gate = readiness.wait(run, "realtime_fixture_postgres_ready", 3000).then(() => {
        ready = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(ready, false, "join alone must not open the write gate");
      connection.replicationReady = true;
      send("system", {
        extension: "postgres_changes",
        status: "ok",
        message: "Subscribed to PostgreSQL",
      });
      await gate;
      insert();
      await bounded("ready event delivered", () => events.messages === generation);
      stop();
      await bounded("connection removed", () => server.clients.size === 0);
    }
    assert.deepEqual(events, { postgresReady: 2, postgresErrors: 0, messages: 2, subscribed: 2 });
  } finally {
    stop?.();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
    await dispatcher.close();
  }
});
