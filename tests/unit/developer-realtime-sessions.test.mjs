import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createRealtimeConnection,
  realtimeGrant,
  parseRealtimeGrant,
  parseRealtimeSessionRequest,
} from "../../src/lib/pricing/developer-realtime-session.mjs";
const input = { model: "realtime", input: "hello", output_modality: "text", max_output_tokens: 64 };
const token = "signed." + "a".repeat(64);
const frame = (type, fields = {}) => JSON.stringify({ type, ...fields });
function fixture() {
  const grant = realtimeGrant();
  const events = [],
    closed = [],
    calls = [];
  let claimed = false,
    revoked = false,
    pending = false;
  const connection = createRealtimeConnection({
    send: (x) => events.push(x),
    close: (...x) => closed.push(x),
    claim: async (id, digest) => {
      assert.equal(id, grant.id);
      assert.equal(digest, grant.digest);
      if (claimed) throw Error("redeemed");
      claimed = true;
      return { id, expiresAt: Date.now() + 100000 };
    },
    check: async () => {
      if (revoked) throw Error("revoked");
      return { id: "key" };
    },
    quote: async (_, body) => {
      calls.push("quote");
      return { quoteToken: token, input: body };
    },
    begin: async () => {
      calls.push("begin");
      return { id: "key" };
    },
    execute: async (_, body, key, quote, signal, delta) => {
      assert.equal(quote, token);
      assert.equal(body.input, "hello");
      calls.push(key);
      delta({ text: "hello" });
      if (pending)
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }),
        );
      return { text: "hello" };
    },
    finish: async () => calls.push("finish"),
    disconnect: async () => calls.push("disconnect"),
  });
  const authenticate = () =>
    connection.receive(frame("session.authenticate", { token: grant.token }));
  const create = (id) =>
    connection.receive(frame("turn.create", { id, input, quote_token: token, request_key: id }));
  return {
    grant,
    connection,
    events,
    closed,
    calls,
    authenticate,
    create,
    revoke: () => {
      revoked = true;
    },
    hold: () => {
      pending = true;
    },
  };
}
test("single-use credentials are hashed and origins are exact", () => {
  const grant = realtimeGrant();
  assert.deepEqual(parseRealtimeGrant(grant.token), { id: grant.id, digest: grant.digest });
  assert.ok(!grant.token.includes(grant.digest));
  assert.deepEqual(
    parseRealtimeSessionRequest("POST", new URLSearchParams(), { origin: "https://example.com" }),
    { operation: "issue", origin: "https://example.com" },
  );
  for (const origin of [
    "https://example.com/",
    "http://example.com",
    "https://user@example.com",
    "https://example.com?a=1",
  ])
    assert.throws(() => parseRealtimeSessionRequest("POST", new URLSearchParams(), { origin }));
});
test("authenticated session supports multiple explicitly authorized turns and deltas", async () => {
  const f = fixture();
  try {
    await f.authenticate();
    assert.equal(f.events[0].type, "session.ready");
    const id = randomUUID();
    await f.connection.receive(frame("turn.quote", { id, input }));
    assert.deepEqual(f.calls, ["quote"]);
    assert.equal(f.events.at(-1).type, "turn.quoted");
    await f.create(id);
    await f.create(randomUUID());
    assert.equal(f.events.filter((e) => e.type === "turn.completed").length, 2);
    assert.equal(f.events.filter((e) => e.type === "turn.delta").length, 2);
    assert.equal(f.calls.filter((x) => x === "finish").length, 2);
  } finally {
    await f.connection.stop();
  }
});
test("unauthenticated input fails before billing; cancellation and revocation terminate work", async () => {
  const bad = fixture();
  await bad.create(randomUUID());
  assert.deepEqual(bad.calls, []);
  assert.equal(bad.closed[0][0], 1008);
  const f = fixture();
  try {
    await f.authenticate();
    f.hold();
    const id = randomUUID();
    const run = f.create(id);
    await new Promise((resolve) => setImmediate(resolve));
    await f.create(randomUUID());
    assert.equal(f.events.at(-1).code, "developer_realtime_conflict");
    await f.connection.receive(frame("turn.cancel", { id }));
    await run;
    assert.equal(f.events.at(-1).type, "turn.cancelled");
    assert.equal(f.calls.filter((x) => x === "finish").length, 1);
    f.revoke();
    await f.connection.heartbeat();
    assert.equal(f.connection.state, "closed");
    assert.equal(f.calls.at(-1), "disconnect");
  } finally {
    await f.connection.stop();
  }
});

test("SDK establishes the exact scoped transport and requires explicit turn confirmation", async () => {
  const { connectRealtimeSession } = await import("../../sdk/javascript/realtime.mjs");
  const grant = {
    id: randomUUID(),
    transport: "/api/developer/realtime/socket",
    protocol: "kova.realtime.v1",
  };
  grant.client_secret = `krt_${grant.id}_${"a".repeat(43)}`;
  const frames = [];
  class Fake extends EventTarget {
    constructor(url, protocol) {
      super();
      assert.equal(url, "wss://kovagpt.com/api/developer/realtime/socket");
      assert.equal(protocol, grant.protocol);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(raw) {
      const frame = JSON.parse(raw);
      frames.push(frame);
      const deliver = (v) =>
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(v) })),
        );
      if (frame.type === "session.authenticate") deliver({ type: "session.ready", id: grant.id });
      if (frame.type === "turn.quote")
        deliver({ type: "turn.quoted", id: frame.id, quote: { quoteToken: token } });
      if (frame.type === "turn.create") {
        deliver({ type: "turn.delta", id: frame.id, kind: "text", delta: "hello" });
        deliver({ type: "turn.completed", id: frame.id, result: { text: "hello" } });
      }
    }
    close() {}
  }
  const s = await connectRealtimeSession(grant, { WebSocketImpl: Fake });
  try {
    assert.equal(frames.length, 1);
    await assert.rejects(s.execute(input, {}), /budget_required/);
    assert.equal((await s.quote(input)).quoteToken, token);
    let delta;
    assert.deepEqual(
      await s.execute(input, {
        quoteToken: token,
        requestKey: randomUUID(),
        onEvent: (e) => (delta = e.delta),
      }),
      { text: "hello" },
    );
    assert.equal(delta, "hello");
    assert.equal(frames.filter((f) => f.type === "turn.create").length, 1);
  } finally {
    s.close();
  }
});
