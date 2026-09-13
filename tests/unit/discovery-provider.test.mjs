import assert from "node:assert/strict";
import test from "node:test";
import {
  discoveryConfiguration,
  discoveryInput,
  publicDiscoveryUrl,
  normalizeDiscoveryProduct,
  localMapHandoff,
} from "../../src/lib/discovery/discovery-policy.mjs";
import {
  runDiscovery,
  issueDiscoverySource,
  verifyDiscoverySource,
} from "../../src/lib/discovery/discovery-provider.mjs";
const env = {
  KOVA_DISCOVERY_ENABLED: "true",
  FIRECRAWL_API_KEY: "provider-secret",
  KOVA_DISCOVERY_SOURCE_SECRET: "s".repeat(40),
  KOVA_DISCOVERY_GLOBAL_DAILY_REQUESTS: "20",
  KOVA_DISCOVERY_USER_DAILY_REQUESTS: "3",
};
const config = discoveryConfiguration(env),
  now = () => Date.parse("2026-09-05T12:00:00Z"),
  owner = "owner";
const input = { operation: "search", mode: "web", query: "public question" };
const reply = () =>
  Response.json({
    success: true,
    data: {
      web: [
        {
          url: "https://merchant.com/product",
          title: "Product",
          description: "Unverified price $9",
        },
      ],
    },
  });
test("discovery fails closed without reviewed positive global and owner caps, key, secret, or feature activation", async () => {
  for (const field of Object.keys(env))
    assert.equal(discoveryConfiguration({ ...env, [field]: "" }).enabled, false);
  for (const bad of ["0", "-1", "1.5", "Infinity", " 2", "100001"])
    assert.equal(
      discoveryConfiguration({ ...env, KOVA_DISCOVERY_GLOBAL_DAILY_REQUESTS: bad }).enabled,
      false,
    );
  assert.equal(discoveryConfiguration({ ...env, KOVA_GENERATION_DISABLED: "true" }).enabled, false);
  let calls = 0;
  await assert.rejects(
    runDiscovery({
      owner,
      input,
      config: { ...config, enabled: false },
      admit: async () => {
        calls++;
        return true;
      },
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /disabled/,
  );
  assert.equal(calls, 0);
});
test("input accepts explicit local place only and never accepts client endpoint, price, provider options, or location in other modes", () => {
  assert.equal(
    discoveryInput({ operation: "search", mode: "local", query: "cafes", location: "Oslo" })
      .location,
    "Oslo",
  );
  for (const bad of [
    { ...input, query: "" },
    { ...input, query: "x".repeat(301) },
    { ...input, mode: "local" },
    { ...input, location: "private location" },
    { ...input, endpoint: "https://evil.com" },
    { ...input, price: 1 },
    { ...input, mode: "shopping", scrapeOptions: {} },
  ])
    assert.throws(() => discoveryInput(bad), /invalid/);
  assert.match(
    localMapHandoff("coffee & tea", "Paris"),
    /^https:\/\/www.google.com\/maps\/search\/\?api=1&query=coffee%20%26%20tea%20Paris$/,
  );
});
test("public source policy excludes IP, credentials, private names, unsafe scheme, and nonstandard ports", () => {
  for (const url of [
    "http://merchant.com",
    "https://127.0.0.1/x",
    "https://2130706433/",
    "https://[::1]/",
    "https://localhost/a",
    "https://printer.local/x",
    "https://name.internal/x",
    "https://user:secret@merchant.com",
    "https://merchant.com:444/",
    "data:image/png;base64,x",
    "https://merchant.com./",
  ])
    assert.equal(publicDiscoveryUrl(url), null, url);
  assert.equal(
    publicDiscoveryUrl("https://merchant.com/path#fragment"),
    "https://merchant.com/path",
  );
});
test("each search consumes admission before one pinned bounded request without owner data or retries", async () => {
  const events = [];
  const result = await runDiscovery({
    owner,
    input,
    config,
    now,
    admit: async () => {
      events.push("admit");
      return true;
    },
    fetchImpl: async (url, init) => {
      events.push("fetch");
      assert.equal(url, "https://api.firecrawl.dev/v2/search");
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.headers.Authorization, "Bearer provider-secret");
      assert.deepEqual(JSON.parse(init.body), {
        query: "public question",
        sources: ["web"],
        limit: 6,
        safe: true,
        timeout: 15000,
      });
      return reply();
    },
  });
  assert.deepEqual(events, ["admit", "fetch"]);
  assert.equal(result.results[0].observedAt, new Date(now()).toISOString());
  assert.equal(result.results[0].price, undefined);
  assert.equal(result.results[0].sourceToken, undefined);
  let calls = 0;
  await assert.rejects(
    runDiscovery({
      owner,
      input,
      config,
      admit: async () => false,
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /daily_limit/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    runDiscovery({
      owner,
      input,
      config,
      admit: async () => {
        throw Error("fence");
      },
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /fence/,
  );
  assert.equal(calls, 0);
});
test("provider HTTP failure is not retried and oversized or malformed responses are rejected", async () => {
  for (const response of [
    () => new Response("failure", { status: 429 }),
    () => Response.json({ success: false, data: { web: [] } }),
    () => new Response("x".repeat(262145)),
    () => Response.json({ success: true, data: { unexpected: [] } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      runDiscovery({
        owner,
        input,
        config,
        admit: async () => true,
        fetchImpl: async () => {
          calls++;
          return response();
        },
      }),
      /unavailable/,
    );
    assert.equal(calls, 1);
  }
});
test("abort before or after admission stops dispatch; response stream cancellation stops a hung read", async () => {
  const c = new AbortController();
  c.abort();
  let calls = 0;
  await assert.rejects(
    runDiscovery({
      owner,
      input,
      config,
      signal: c.signal,
      admit: async () => {
        calls++;
        return true;
      },
    }),
    /cancelled/,
  );
  assert.equal(calls, 0);
  const d = new AbortController();
  await assert.rejects(
    runDiscovery({
      owner,
      input,
      config,
      signal: d.signal,
      admit: async () => {
        d.abort();
        return true;
      },
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /cancelled/,
  );
  assert.equal(calls, 0);
  const e = new AbortController();
  let cancelled = false;
  const job = runDiscovery({
    owner,
    input,
    config,
    signal: e.signal,
    admit: async () => true,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          pull() {
            e.abort();
            return new Promise(() => {});
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(job, /cancelled/);
  assert.equal(cancelled, true);
});
test("image search requests only image metadata and never contacts a returned image host", async () => {
  const urls = [];
  const result = await runDiscovery({
    owner,
    input: { ...input, mode: "images" },
    config,
    now,
    admit: async () => true,
    fetchImpl: async (url, init) => {
      urls.push(url);
      assert.deepEqual(JSON.parse(init.body).sources, ["images"]);
      return Response.json({
        success: true,
        data: {
          images: [
            {
              title: "Object",
              url: "https://source.com/page",
              imageUrl: "https://images.com/object.png",
            },
            { url: "https://source.com", imageUrl: "https://localhost/image" },
          ],
        },
      });
    },
  });
  assert.equal(urls.length, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].source, "source.com");
  assert.equal(result.results[0].imageUrl, "https://images.com/object.png");
});
test("merchant check source tokens bind owner URL and expiry, reject tamper before spending admission", async () => {
  const token = issueDiscoverySource(
    owner,
    "https://merchant.com/product",
    config.signingSecret,
    now(),
  );
  assert.equal(
    verifyDiscoverySource(token, owner, config.signingSecret, now()),
    "https://merchant.com/product",
  );
  for (const [t, u, time] of [
    [token, "other", now()],
    [token, owner, now() + 900000],
    [token + "x", owner, now()],
    ["bad", owner, now()],
  ])
    assert.throws(() => verifyDiscoverySource(t, u, config.signingSecret, time), /expired/);
  let calls = 0;
  await assert.rejects(
    runDiscovery({
      owner: "other",
      input: { operation: "product", sourceToken: token },
      config,
      now,
      admit: async () => {
        calls++;
        return true;
      },
    }),
    /expired/,
  );
  assert.equal(calls, 0);
});
const productReply = () => ({
  success: true,
  data: {
    metadata: { statusCode: 200, sourceURL: "https://merchant.com/product" },
    product: {
      url: "https://merchant.com/product",
      title: "Coat",
      brand: "Maker",
      variants: [
        {
          id: "red-s",
          sku: "R1",
          title: "Small red",
          values: { color: "red", size: "S" },
          price: { amount: 25, currency: "EUR" },
          availability: { inStock: true },
        },
        { id: "blue-l", price: { amount: 32, currency: "USD" }, availability: { inStock: false } },
        { title: "Other", price: { amount: 99 }, availability: { text: "Maybe" } },
      ],
    },
  },
});
test("merchant verification preserves variant identity, separate currencies, unknown fields, and check time", async () => {
  const token = issueDiscoverySource(
    owner,
    "https://merchant.com/product",
    config.signingSecret,
    now(),
  );
  let calls = 0;
  const result = await runDiscovery({
    owner,
    input: { operation: "product", sourceToken: token },
    config,
    now,
    admit: async () => true,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.firecrawl.dev/v2/scrape");
      assert.deepEqual(JSON.parse(init.body), {
        url: "https://merchant.com/product",
        formats: ["product"],
        maxAge: 0,
        parsers: [],
        timeout: 15000,
      });
      return Response.json(productReply());
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.product.variants[0].price, { amount: 25, currency: "EUR" });
  assert.equal(result.product.variants[0].sku, "R1");
  assert.equal(result.product.variants[1].price.currency, "USD");
  assert.equal(result.product.variants[1].inStock, false);
  assert.equal(result.product.variants[2].price, null);
  assert.equal(result.product.variants[2].inStock, null);
});
test("HTTP200 cannot mask a blocked target, cross-origin redirect, or ambiguous product identity", () => {
  for (const status of [403, 404, 500, undefined]) {
    const p = productReply();
    p.data.metadata.statusCode = status;
    assert.throws(
      () =>
        normalizeDiscoveryProduct(p, "https://merchant.com/product", new Date(now()).toISOString()),
      /page_unavailable/,
    );
  }
  const p = productReply();
  p.data.metadata.sourceURL = "https://other.com/product";
  assert.throws(
    () => normalizeDiscoveryProduct(p, "https://merchant.com/product", "now"),
    /page_unavailable/,
  );
  const q = productReply();
  q.data.product.url = "https://other.com/product";
  assert.equal(
    normalizeDiscoveryProduct(q, "https://merchant.com/product", "now").status,
    "unknown",
  );
  const r = productReply();
  r.data.product.variants = [];
  assert.equal(
    normalizeDiscoveryProduct(r, "https://merchant.com/product", "now").status,
    "unknown",
  );
});

test("browser response parsing bounds unknown lengths and cancels a hung stream", async () => {
  const { readDiscoveryResponse } = await import("../../src/lib/discovery/discovery-client.mjs");
  const c = new AbortController();
  await assert.rejects(
    readDiscoveryResponse(
      new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }),
      c.signal,
    ),
    /too_large/,
  );
  await assert.rejects(readDiscoveryResponse(Response.json([]), c.signal), /Invalid/);
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull() {
        c.abort();
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  await assert.rejects(readDiscoveryResponse(response, c.signal));
  assert.equal(cancelled, true);
});

test("browser admission timeout settles stalled session acquisition and rejects switched owner before dispatch", async () => {
  const { requestDiscovery } = await import("../../src/lib/discovery/discovery-client.mjs");
  let calls = 0;
  await assert.rejects(
    requestDiscovery({
      owner,
      timeoutMs: 20,
      getSession: () => new Promise(() => {}),
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /timed out/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    requestDiscovery({
      owner,
      getSession: async () => ({
        data: { session: { user: { id: "other" }, access_token: "never-send" } },
      }),
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    }),
    /account changed/,
  );
  assert.equal(calls, 0);
  const c = new AbortController();
  const pending = requestDiscovery({
    owner,
    signal: c.signal,
    getSession: () => new Promise(() => {}),
    fetchImpl: async () => {
      calls++;
      return reply();
    },
  });
  c.abort();
  await assert.rejects(pending);
  assert.equal(calls, 0);
  const product = productReply();
  product.data.product.variants = [null];
  assert.equal(
    normalizeDiscoveryProduct(product, "https://merchant.com/product", "now").status,
    "unknown",
  );
});

test("comparison identity survives reordered merchant variants without merging distinct currencies or unidentified options", async () => {
  const { discoveryComparisonKey } = await import("../../src/lib/discovery/discovery-policy.mjs");
  const product = normalizeDiscoveryProduct(productReply(), "https://merchant.com/product", "now");
  const first = product.variants[0];
  assert.equal(
    discoveryComparisonKey(product, first),
    discoveryComparisonKey(product, { ...first, ordinal: 3, values: { size: "S", color: "red" } }),
  );
  assert.notEqual(
    discoveryComparisonKey(product, first),
    discoveryComparisonKey(product, product.variants[1]),
  );
  const sku = { ...first, id: "" };
  assert.equal(
    discoveryComparisonKey(product, sku),
    discoveryComparisonKey(product, { ...sku, ordinal: 7, values: { size: "S", color: "red" } }),
  );
  assert.notEqual(
    discoveryComparisonKey(product, sku),
    discoveryComparisonKey(product, { ...sku, values: { size: "L", color: "red" } }),
  );
});
