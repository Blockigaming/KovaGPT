import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as routerServer from "@tanstack/router-core/ssr/server";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const handlerPath = "node_modules/@tanstack/start-server-core/src/server-functions-handler.ts";
const requireServer = createRequire(new URL(`../../${handlerPath}`, import.meta.url));
const seroval = requireServer("seroval");
const client = await import("@tanstack/start-client-core");

// Executes the installed transport handler; replaces only the application function
// lookup, request-local response store and application custom-plugin lookup.
// Installed serialization plugins remain real. No listener, backend or provider call.
function loadHandler(action) {
  return loadUiModule(
    handlerPath,
    {
      "@tanstack/router-core": {
        invariant: () => assert.fail("unexpected invariant"),
        isNotFound: () => false,
        isRedirect: () => false,
      },
      "@tanstack/router-core/ssr/server": routerServer,
      "@tanstack/start-client-core": { ...client, getSerovalPlugins: (defaults) => defaults },
      "@tanstack/start-client-core/client-rpc": {
        MAX_FRAMED_STREAMS: 16,
        MAX_FRAME_PAYLOAD_SIZE: 65536,
      },
      seroval,
      "./request-response": { getResponse: () => ({ status: 200, statusText: "OK" }) },
      "./getServerFnById": { getServerFnById: async () => action },
      "./frame-protocol": { createMultiplexedStream: () => assert.fail("unexpected stream") },
    },
    { Request, Response, URL, TextEncoder, ReadableStream, process: { env: { NODE_ENV: "test" } } },
  ).handleServerAction;
}

test("minimum patched Start family is exact in source, lock and installed runtime", () => {
  const pkg = JSON.parse(readFileSync("package.json"));
  const lock = JSON.parse(readFileSync("package-lock.json"));
  const expected = {
    "@tanstack/react-start": "1.168.60",
    "@tanstack/react-router": "1.170.41",
    "@tanstack/router-core": "1.171.34",
    "@tanstack/router-plugin": "1.168.42",
    "@tanstack/history": "1.162.4",
  };
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(pkg.dependencies[name], version);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    assert.equal(JSON.parse(readFileSync(`node_modules/${name}/package.json`)).version, version);
  }
  const serverCopies = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith("node_modules/@tanstack/start-server-core"),
  );
  assert.ok(serverCopies.length > 0);
  for (const [, value] of serverCopies) assert.equal(value.version, "1.169.39");
});

for (const method of ["GET", "POST"]) {
  test(`${method} transport does not forward client-controlled result/error/response fields`, async () => {
    let observed;
    const handler = loadHandler(async (params) => {
      observed = params;
      return { result: null };
    });
    const payload = await seroval.toJSONAsync({
      data: { safe: true },
      context: { clientFlag: true, authority: "attacker" },
      result: { headers: { "Content-Type": "text/html" }, body: "<script>fixture</script>" },
      error: "attacker",
      method: "DELETE",
      response: "attacker",
    });
    const url = new URL("https://fixture.invalid/server-function");
    if (method === "GET") url.searchParams.set("payload", JSON.stringify(payload));
    const request = new Request(url, {
      method,
      ...(method === "POST"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        : {}),
    });
    const response = await handler({
      request,
      context: { authority: "server" },
      serverFnId: "fixture",
    });
    assert.equal(response, null);
    assert.deepEqual(Object.keys(observed).sort(), ["context", "data", "method"]);
    assert.equal(observed.method, method);
    assert.equal(observed.context.authority, "server");
    assert.equal(observed.data.safe, true);
  });
}

test("ordinary object result cannot become an implicit HTML response", async () => {
  const handler = loadHandler(async () => ({
    result: { body: "<script>fixture</script>", headers: { "Content-Type": "text/html" } },
  }));
  const result = await handler({
    request: new Request("https://fixture.invalid/server-function"),
    context: {},
    serverFnId: "fixture",
  });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Content-Type"), "application/json");
  const body = await result.text();
  assert.doesNotThrow(() => JSON.parse(body));
  assert.match(body, /fixture/);
  assert.doesNotMatch(body, /TypeError|Server Fn Error/);
});
