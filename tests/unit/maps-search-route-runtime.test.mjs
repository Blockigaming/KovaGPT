import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/routes/api/maps/search.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const place = {
  id: "42",
  name: "Boston, Massachusetts, United States",
  latitude: 42.3601,
  longitude: -71.0589,
  type: "city",
  address: { city: "Boston", state: "Massachusetts" },
  bounds: [-71.1912, 42.2279, -70.8045, 42.3969],
};

function fixture({
  userId = "user-a",
  authResponse = null,
  lockdownError = null,
  clientAllowed = true,
  cacheData = null,
  cacheError = null,
  cacheThrows = false,
  admissionAllowed = true,
  admissionError = null,
  writeError = null,
  writeThrows = false,
  providerReadThrows = false,
  providerPayload,
} = {}) {
  const calls = [];
  const writes = [];
  const admin = {
    from(table) {
      calls.push(["cache", table]);
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gt() {
          return builder;
        },
        async maybeSingle() {
          calls.push(["cache-read"]);
          if (cacheThrows) throw new Error("cache unavailable");
          return { data: cacheData, error: cacheError };
        },
        async upsert(value, options) {
          calls.push(["cache-write"]);
          if (writeThrows) throw new Error("cache unavailable");
          writes.push({ value, options });
          return { error: writeError };
        },
      };
      return builder;
    },
    async rpc(name) {
      calls.push(["admission", name]);
      return {
        data: { allowed: admissionAllowed, retry_after: 1 },
        error: admissionError,
      };
    },
  };
  const modules = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      requireUser: async () => {
        calls.push(["auth"]);
        return authResponse ?? { userId, supabaseAdmin: admin };
      },
    },
    "@/lib/bounded-json.server.mjs": {
      readBoundedUtf8: async (response) => {
        calls.push(["provider-read"]);
        if (providerReadThrows) throw new Error("provider response too large");
        return response.text();
      },
    },
    "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "client" },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => {
        calls.push(["client-limit"]);
        return { allowed: clientAllowed, status: "limited", retryAfter: 7 };
      },
    },
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async () => {
        calls.push(["lockdown"]);
        if (lockdownError) throw lockdownError;
      },
      lockdownErrorResponse: () =>
        lockdownError ? Response.json({ error: "Lockdown Mode is on." }, { status: 403 }) : null,
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected import ${name}`);
      return modules[name];
    },
    Response,
    URL,
    AbortSignal,
    TextEncoder,
    Uint8Array,
    crypto,
    console: { error() {} },
    fetch: async () => {
      calls.push(["provider-fetch"]);
      return Response.json(
        providerPayload ?? [
          {
            place_id: 42,
            display_name: place.name,
            lat: String(place.latitude),
            lon: String(place.longitude),
            type: place.type,
            address: place.address,
            boundingbox: ["42.2279", "42.3969", "-71.1912", "-70.8045"],
          },
        ],
      );
    },
  });
  const get = exports.Route.server.handlers.GET;
  const request = (query = "Boston", language = "en-US") =>
    new Request(`https://kovagpt.test/api/maps/search?q=${encodeURIComponent(query)}`, {
      headers: { "X-Kova-Expected-User": userId, "Accept-Language": language },
    });
  return { calls, get, request, writes };
}

test("a valid Maps cache hit skips provider admission and fetch", async () => {
  const f = fixture({ cacheData: { payload: { results: [place] } } });
  const response = await f.get({ request: f.request() });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [place]);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["auth", "lockdown", "client-limit", "cache", "cache-read"],
  );
  assert.equal(f.writes.length, 0);
});

test("a cache miss admits, fetches, sanitizes, and writes a 24-hour shared entry", async () => {
  const f = fixture();
  const before = Date.now();
  const response = await f.get({ request: f.request("10 Main Street", "en-US") });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [place]);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    [
      "auth",
      "lockdown",
      "client-limit",
      "cache",
      "cache-read",
      "admission",
      "provider-fetch",
      "provider-read",
      "cache",
      "cache-write",
    ],
  );
  assert.equal(f.writes.length, 1);
  const cached = f.writes[0].value;
  assert.match(cached.cache_key, /^v1:[0-9a-f]{64}$/u);
  assert.equal(cached.cache_key.includes("10 Main Street"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(cached.payload)), { results: [place] });
  const ttl = Date.parse(cached.expires_at) - before;
  assert.ok(ttl >= 24 * 60 * 60 * 1_000 - 1_000 && ttl <= 24 * 60 * 60 * 1_000 + 1_000);
});

test("provider denial returns 429 without fetch or cache write", async () => {
  const f = fixture({ admissionAllowed: false });
  const response = await f.get({ request: f.request() });
  assert.equal(response.status, 429);
  assert.equal(
    f.calls.some(([name]) => name === "provider-fetch"),
    false,
  );
  assert.equal(
    f.calls.some(([name]) => name === "cache-write"),
    false,
  );
});

test("an invalid or oversized provider body is rejected before caching", async () => {
  const f = fixture({ providerReadThrows: true });
  const response = await f.get({ request: f.request() });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Place search returned an invalid response." });
  assert.equal(
    f.calls.some(([name]) => name === "cache-write"),
    false,
  );
});

test("malformed provider entries cannot become cached fake coordinates", async () => {
  const validWithoutBounds = {
    id: "7",
    name: "Valid place",
    latitude: 42,
    longitude: -71,
    type: "place",
    address: {},
    bounds: null,
  };
  const f = fixture({
    providerPayload: [
      null,
      {
        place_id: 6,
        display_name: "Fake origin",
        lat: null,
        lon: "",
        boundingbox: "not-an-array",
      },
      {
        place_id: 7,
        display_name: "Valid place",
        lat: "42",
        lon: "-71",
        boundingbox: "not-an-array",
      },
    ],
  });
  const response = await f.get({ request: f.request() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [validWithoutBounds] });
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].value.payload)), {
    results: [validWithoutBounds],
  });
});

test("malformed and failed cache reads are safe misses while writes are best effort", async () => {
  for (const options of [
    { cacheData: { payload: { results: [{ ...place, latitude: "bad" }] } } },
    { cacheError: new Error("cache unavailable") },
    { cacheThrows: true },
    { writeError: new Error("cache unavailable") },
    { writeThrows: true },
  ]) {
    const f = fixture(options);
    const response = await f.get({ request: f.request() });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).results, [place]);
    assert.equal(
      f.calls.some(([name]) => name === "provider-fetch"),
      true,
    );
  }
});

test("validation, auth, account, Lockdown, and client denials precede cache access", async () => {
  const invalid = fixture();
  assert.equal((await invalid.get({ request: invalid.request("x") })).status, 400);
  assert.equal(invalid.calls.length, 0);

  const denied = fixture({ authResponse: new Response(null, { status: 401 }) });
  assert.equal((await denied.get({ request: denied.request() })).status, 401);
  assert.deepEqual(
    denied.calls.map(([name]) => name),
    ["auth"],
  );

  const mismatch = fixture();
  const mismatchRequest = new Request("https://kovagpt.test/api/maps/search?q=Boston", {
    headers: { "X-Kova-Expected-User": "another-user" },
  });
  assert.equal((await mismatch.get({ request: mismatchRequest })).status, 409);
  assert.deepEqual(
    mismatch.calls.map(([name]) => name),
    ["auth"],
  );

  const lockdown = fixture({ lockdownError: new Error("blocked") });
  assert.equal((await lockdown.get({ request: lockdown.request() })).status, 403);
  assert.deepEqual(
    lockdown.calls.map(([name]) => name),
    ["auth", "lockdown"],
  );

  const limited = fixture({ clientAllowed: false });
  assert.equal((await limited.get({ request: limited.request() })).status, 429);
  assert.deepEqual(
    limited.calls.map(([name]) => name),
    ["auth", "lockdown", "client-limit"],
  );
});

test("cache identity is shared across users and changes with language", async () => {
  const first = fixture({ userId: "user-a" });
  const second = fixture({ userId: "user-b" });
  const french = fixture({ userId: "user-a" });
  await first.get({ request: first.request("Boston", "en-US") });
  await second.get({ request: second.request("Boston", "en-US") });
  await french.get({ request: french.request("Boston", "fr-FR") });
  assert.equal(first.writes[0].value.cache_key, second.writes[0].value.cache_key);
  assert.notEqual(first.writes[0].value.cache_key, french.writes[0].value.cache_key);
});
