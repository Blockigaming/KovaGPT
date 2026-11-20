import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { ChatBrowserRelay, maxBrowserFrameBytes } from "../../src/lib/chat-browser-relay.server.ts";

test("replicas relay control only to the session owner and protect input and frames", async () => {
  const secret = randomBytes(32).toString("hex");
  const ownerId = randomUUID();
  const requestId = randomUUID();
  const packetSizes = [];
  const packets = [];
  const peers = [];
  const client = () => ({
    async setAuth(key) {
      assert.equal(key, secret);
    },
    channel(topic, { config }) {
      assert.equal(config.private, true);
      const handlers = new Map();
      const peer = { topic, handlers };
      peers.push(peer);
      return {
        on(_type, { event }, cb) {
          handlers.set(event, cb);
        },
        subscribe(cb) {
          cb("SUBSCRIBED");
        },
        async send({ event, payload }) {
          packets.push(payload);
          packetSizes.push(Buffer.byteLength(JSON.stringify({ event, payload })));
          for (const other of peers) {
            if (other === peer || other.topic !== topic) continue;
            const deliver = other.handlers.get(event);
            deliver({ payload });
            if (event === "command") deliver({ payload });
          }
          return "ok";
        },
      };
    },
  });

  const remoteReplica = new ChatBrowserRelay(client(), secret, () => undefined);
  const calls = [];
  const frame = {
    id: randomUUID(),
    width: 1600,
    height: 1200,
    jpeg: randomBytes(maxBrowserFrameBytes).toString("base64"),
  };
  new ChatBrowserRelay(client(), secret, (owner, request) => {
    if (owner === ownerId && request === requestId)
      return async (action) => {
        calls.push(action);
        return { frame: action.kind === "release" ? null : frame };
      };
  });

  const input = { kind: "input", text: "Private browser input" };
  assert.deepEqual(await remoteReplica.forward(ownerId, requestId, input), { frame });
  assert.deepEqual(await remoteReplica.forward(ownerId, requestId, { kind: "release" }), {
    frame: null,
  });
  peers[1].handlers.get("command")({ payload: { sealed: JSON.stringify(input) } });
  assert.deepEqual(calls, [input, { kind: "release" }]);
  assert.ok(packetSizes.every((size) => size < 256_000));
  assert.ok(!JSON.stringify(packets).includes(input.text));
  assert.ok(!JSON.stringify(packets).includes(frame.jpeg));
});
