import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
function fixture({
  readyGate = Promise.resolve(),
  fetcher = async () => Response.json({}),
  permission = async () => "granted",
} = {}) {
  let sessionOwner = owner,
    swOwner = null,
    epoch = 0,
    subscribeCalls = 0;
  const messages = [];
  const ready = {
    active: {
      postMessage(data, ports) {
        messages.push(data);
        let result = { ok: true };
        if (data.type === "STATE") result = { ok: true, ownerId: swOwner, epoch };
        else if (data.type === "OWNER") {
          if (data.expectedEpoch !== epoch) result = { ok: false };
          else {
            if (swOwner !== data.ownerId) {
              swOwner = data.ownerId;
              epoch++;
            }
            result = { ok: true, epoch };
          }
        }
        ports[0].postMessage(result);
        ports[0].close();
      },
    },
    pushManager: {
      subscribe: async () => {
        subscribeCalls++;
        return {
          toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/device", keys: {} }),
          unsubscribe: async () => true,
        };
      },
    },
  };
  const exports = {},
    deps = {
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: {
                session: sessionOwner
                  ? { user: { id: sessionOwner }, access_token: "fixture" }
                  : null,
              },
            }),
          },
        },
      },
      "@/lib/endpoint-reliability.mjs": { readResponseBytesBounded },
    };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/pwa/client.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      navigator: {
        serviceWorker: { register: async () => ready, ready: readyGate.then(() => ready) },
      },
      window: { isSecureContext: true },
      Notification: { permission: "default", requestPermission: permission },
      fetch: fetcher,
      MessageChannel,
      AbortSignal,
      AbortController,
      TextDecoder,
      URL,
      Uint8Array,
      atob,
      setTimeout,
      clearTimeout,
    },
  );
  return {
    api: exports,
    messages,
    setUser: (value) => {
      sessionOwner = value;
    },
    subscribeCalls: () => subscribeCalls,
  };
}
test("owner messages recheck the real current session after service worker readiness before posting", async () => {
  let release;
  const readyGate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ readyGate });
  const first = f.api.setPwaOwner(owner);
  const reject = assert.rejects(first, /account changed/);
  f.setUser(other);
  const second = f.api.setPwaOwner(other);
  release();
  await reject;
  await second;
  assert.deepEqual(
    f.messages.filter((row) => row.type === "OWNER").map((row) => row.ownerId),
    [other],
  );
});
test("same-user setup shares one durable owner epoch and a changed session cannot use stale local bindings", async () => {
  const f = fixture();
  await Promise.all([f.api.setPwaOwner(owner), f.api.setPwaOwner(owner)]);
  assert.equal(f.messages.filter((row) => row.type === "OWNER").length, 1);
  f.setUser(other);
  await assert.rejects(f.api.pwaMessage({ type: "BINDING", ownerId: owner }), /account changed/);
  assert.equal(f.messages.filter((row) => row.type === "BINDING").length, 0);
});
test("an abandoned browser permission prompt cannot subscribe the next account", async () => {
  let release;
  const f = fixture({
    permission: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await f.api.setPwaOwner(owner);
  const pending = f.api.enableDevicePush(owner, "unused", new AbortController().signal);
  f.setUser(other);
  await f.api.setPwaOwner(other);
  release("granted");
  await assert.rejects(pending, /account changed/);
  assert.equal(f.subscribeCalls(), 0);
});
test("a subscribe response arriving after account change is compensated with its revocation capability", async () => {
  let release;
  const calls = [];
  const f = fixture({
    fetcher: async (path, init) => {
      calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
      if (path === "/api/push")
        return new Promise((resolve) => {
          release = () =>
            resolve(Response.json({ id: "device", revision: 1, deviceSecret: "capability" }));
        });
      return Response.json({ ok: true });
    },
  });
  await f.api.setPwaOwner(owner);
  const pending = f.api.pushApi(owner, new AbortController().signal, {
    action: "subscribe",
    subscription: {},
  });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  f.setUser(other);
  await f.api.setPwaOwner(other);
  release();
  await assert.rejects(pending, /account changed/);
  assert.equal(calls[0].body.expectedUserId, owner);
  assert.deepEqual(calls[1], {
    path: "/api/push/revoke-device",
    body: { id: "device", deviceSecret: "capability" },
  });
});
