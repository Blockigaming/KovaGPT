import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleDocumentExportDelivery as handle } from "../../src/lib/document-export-delivery.server.mjs";
import {
  DOCUMENT_EXPORT_TYPES,
  MAX_DOCUMENT_EXPORT_BYTES,
  MAX_DOCUMENT_EXPORT_FORM_BYTES,
  encodeDocumentExportBytes,
} from "../../src/lib/document-export-policy.mjs";
import { load, fonts } from "../helpers/document-writers.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const origin = "https://kova.test";
const allowed = async () => ({ allowed: true, status: "allowed", retryAfter: 60 });
function request(fields = {}, headers = {}, options = {}) {
  return new Request(`${origin}/api/document-export`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams({
      format: "md",
      filename: "Result.md",
      bytes: encodeDocumentExportBytes(new TextEncoder().encode("Café\r\n  exact draft\t🙂")),
      ...fields,
    }),
    ...options,
  });
}
const send = (req, consumeRateLimit = allowed) => handle(req, { consumeRateLimit });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("actual route uses the shared relay with the existing distributed rate limiter", async () => {
  let received;
  const limiter = async () => {};
  const { Route } = loadUiModule("src/routes/api/document-export.ts", {
    "@tanstack/react-router": {
      createFileRoute: (path) => {
        assert.equal(path, "/api/document-export");
        return (options) => options;
      },
    },
    "@/lib/document-export-delivery.server.mjs": {
      handleDocumentExportDelivery: (...args) => {
        received = args;
        return "response";
      },
    },
    "@/lib/distributed-rate-limit.server": { consumeApplicationRateLimit: limiter },
  });
  const req = request();
  assert.equal(await Route.server.handlers.POST({ request: req }), "response");
  assert.equal(received[0], req);
  assert.equal(received[1].consumeRateLimit, limiter);
  assert.deepEqual(Object.keys(Route.server.handlers), ["POST"]);
  assert.match(readFileSync("src/routeTree.gen.ts", "utf8"), /ApiDocumentExportRoute/);
});

test("guest, Temporary, and cookie-bearing callers receive only their submitted exact bytes", async () => {
  for (const cookie of [undefined, "__Host-kova_session=opaque", "review_session=fictional"]) {
    const req = request({}, cookie ? { cookie } : {});
    const expected = new TextEncoder().encode("Café\r\n  exact draft\t🙂");
    const response = await send(req);
    assert.equal(response.status, 200);
    assert.equal(sha(new Uint8Array(await response.arrayBuffer())), sha(expected));
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.equal(response.headers.get("content-type"), "text/plain;charset=utf-8");
    assert.equal(
      response.headers.get("content-disposition"),
      "attachment; filename*=UTF-8''Result.md",
    );
    for (const [key, value] of [
      ["cache-control", "no-store"],
      ["x-content-type-options", "nosniff"],
      ["cross-origin-resource-policy", "same-origin"],
    ])
      assert.equal(response.headers.get(key), value);
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

test("actual generated PDF bytes and all fixed format/MIME pairs survive HTTP delivery unchanged", async () => {
  const { createDocumentPdf } = load("src/lib/writing-export/pdf.ts");
  const pdf = await createDocumentPdf(
    "Fictional result",
    "# Export check\n\nCafé and exact fictional content.",
    fonts,
  );
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  for (const [format, mime] of Object.entries(DOCUMENT_EXPORT_TYPES)) {
    const bytes = format === "pdf" ? pdf : Uint8Array.from([0, 1, 127, 128, 254, 255]);
    const response = await send(
      request({ format, filename: `Résultat.${format}`, bytes: encodeDocumentExportBytes(bytes) }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.equal(sha(new Uint8Array(await response.arrayBuffer())), sha(bytes));
  }
});

test("missing/null/cross-origin/same-site requests fail before rate or body access", async () => {
  for (const headers of [
    { origin: undefined },
    { origin: "null" },
    { origin: "https://other.test" },
    { origin: "https://kova.test:444" },
    { origin: "https://kova.test/" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const req = request();
    for (const [key, value] of Object.entries(headers))
      value === undefined ? req.headers.delete(key) : req.headers.set(key, value);
    Object.defineProperty(req, "body", { get: () => assert.fail("Rejected request body read") });
    assert.equal((await send(req, () => assert.fail("Rejected request rate check"))).status, 403);
  }
  assert.equal((await send(new Request(`${origin}/api/document-export`))).status, 405);
  assert.equal(
    (
      await send(
        new Request(`${origin}/api/document-export?bytes=secret`, {
          method: "POST",
          headers: { origin },
        }),
      )
    ).status,
    403,
  );
});

test("anonymous rate gate precedes parsing, ignores spoofed forwarding, and fails closed", async () => {
  let input;
  const req = request({}, { "x-forwarded-for": "1.2.3.4" });
  Object.defineProperty(req, "body", { get: () => assert.fail("Limited body read") });
  const limited = await send(req, async (value) => {
    input = value;
    return { allowed: false, status: "limited", retryAfter: 44 };
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "44");
  assert.deepEqual(input, {
    identity: "ip:unknown",
    action: "document_export_delivery",
    limit: 10,
    windowSeconds: 60,
  });
  const unavailable = await send(req, async () => {
    throw Error("Private limiter detail");
  });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /Private limiter/);
  assert.equal(
    (
      await send(req, () => {
        throw Error("Synchronous limiter failure");
      })
    ).status,
    503,
  );
  await send(request({}, { "cf-connecting-ip": "203.0.113.5" }), async (value) => {
    assert.equal(value.identity, "ip:203.0.113.5");
    return allowed();
  });
});

test("strict field, format, base64url and filename contracts reject ambiguity", async () => {
  for (const fields of [
    { format: "svg", filename: "x.svg" },
    { format: "constructor" },
    { filename: "x.exe" },
    { filename: "x".repeat(201) + ".md" },
    { bytes: "+/8=" },
    { bytes: "A" },
    { bytes: "AB" },
    { bytes: "AA==" },
    { bytes: "AA " },
    { bytes: "é" },
    { type: "text/html" },
    { redirect: "https://other.test" },
  ])
    assert.equal((await send(request(fields))).status, 400, JSON.stringify(fields));
  assert.equal((await send(request({}, { "content-type": "application/json" }))).status, 415);
  for (const body of [
    "format=md&filename=x.md",
    "format=md&filename=x.md&bytes=&bytes=AA",
    "format=md&format=pdf&filename=x.md&bytes=",
  ]) {
    assert.equal((await send(request({}, {}, { body }))).status, 400);
  }
});

test("attachment names are inert and errors never reflect submitted private text", async () => {
  const response = await send(request({ filename: '../../Café\r\nX-Hack: yes "<>.md' }));
  assert.equal(response.status, 200);
  const name = response.headers.get("content-disposition");
  assert.match(name, /^attachment; filename\*=UTF-8''/);
  assert.doesNotMatch(name, /[\r\n"<>]|\.\.\//);
  assert.equal(response.headers.get("x-hack"), null);
  const failed = await send(
    request({ format: "<script>private draft</script>", filename: "secret.md" }),
  );
  const html = await failed.text();
  assert.doesNotMatch(html, /<script|private draft|secret.md/);
  assert.match(html, /original result is still open/);
});

test("encoded and decoded ceilings hold without Content-Length and at exact8MiB", async () => {
  assert.ok(MAX_DOCUMENT_EXPORT_FORM_BYTES < 16 * 1024 * 1024);
  const exact = new Uint8Array(MAX_DOCUMENT_EXPORT_BYTES).fill(255);
  const response = await send(request({ bytes: encodeDocumentExportBytes(exact) }));
  assert.equal(response.status, 200);
  assert.equal(sha(new Uint8Array(await response.arrayBuffer())), sha(exact));
  assert.throws(
    () => encodeDocumentExportBytes(new Uint8Array(MAX_DOCUMENT_EXPORT_BYTES + 1)),
    /8 MiB/,
  );
  const tooMany = Buffer.alloc(MAX_DOCUMENT_EXPORT_BYTES + 1).toString("base64url");
  assert.equal((await send(request({ bytes: tooMany }))).status, 413);
  const overlong = request({}, { "content-length": String(MAX_DOCUMENT_EXPORT_FORM_BYTES + 1) });
  assert.equal((await send(overlong)).status, 413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_DOCUMENT_EXPORT_FORM_BYTES + 1));
      controller.close();
    },
  });
  assert.equal((await send(request({}, {}, { body: stream, duplex: "half" }))).status, 413);
});

test("aborted/incomplete body is cancelled and produces a fixed timeout response", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const pending = send(
    request({}, {}, { body: stream, duplex: "half", signal: controller.signal }),
  );
  await Promise.resolve();
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
});

test("a stalled request hits the10-second body deadline without indefinite rescheduling", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const pending = send(
    request(
      {},
      {},
      {
        body: new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        duplex: "half",
      },
    ),
  );
  for (let index = 0; index < 6; index++) await Promise.resolve();
  context.mock.timers.tick(10_000);
  assert.equal((await pending).status, 504);
  assert.equal(cancelled, true);
});

function serverFixture(handler) {
  const security = loadUiModule(
    "src/lib/http-security.server.ts",
    {},
    { TextEncoder, Response, URL },
  );
  return loadUiModule(
    "src/server.ts",
    {
      "./lib/error-page": { renderErrorPage: () => "Server unavailable" },
      "./lib/http-security.server": security,
      "./lib/azure-runtime-env.server": { validateAzureRuntimeEnv() {} },
      "./lib/origin-boundary.server": {
        enforceAzureProductionOriginBoundary: () => null,
        normalizeAzureProductionRequest: (request) => request,
      },
      "./lib/runtime-env.server": { withRuntimeBindings: (_env, run) => run() },
      "@tanstack/react-start/server-entry": { __esModule: true, default: { fetch: handler } },
    },
    { Response, Headers, URL },
  ).default;
}

test("failure pages allow only their exact trusted CSS while the final wrapper keeps default-deny", async () => {
  const server = serverFixture((req) => send(req));
  for (const [response, expectedPolicies] of [
    [await send(request({ format: "invalid" })), 1],
    [await server.fetch(request({ format: "invalid" }), {}, {}), 2],
  ]) {
    assert.equal(response.status, 400);
    const html = await response.text();
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)];
    assert.equal(styles.length, 1);
    const styleHash = createHash("sha256").update(styles[0][1]).digest("base64");
    const policies = response.headers.get("content-security-policy").split(/,\s*(?=default-src )/u);
    assert.equal(policies.length, expectedPolicies);
    assert.equal(policies[0], `default-src 'none'; sandbox; style-src 'sha256-${styleHash}'`);
    if (expectedPolicies === 2) {
      assert.match(policies[1], /^default-src 'self';/u);
      assert.match(policies[1], /style-src 'self' 'unsafe-inline'/u);
    }
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.doesNotMatch(html, /<script|<iframe|<form|style=/iu);
  }
});

test("final server wrapper retains only exact restrictive export POST policies and exact bytes", async () => {
  const server = serverFixture((req) => send(req));
  const response = await server.fetch(request(), {}, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(await response.text(), "Café\r\n  exact draft\t🙂");
  for (const [path, method, supplied] of [
    ["/api/document-export", "GET", "default-src 'none'; sandbox"],
    ["/api/other", "POST", "default-src 'none'; sandbox"],
    ["/api/document-export", "POST", "default-src *; script-src * 'unsafe-inline'"],
  ]) {
    const other = serverFixture(
      () =>
        new Response("safe", {
          headers: { "Content-Security-Policy": supplied, "Referrer-Policy": "unsafe-url" },
        }),
    );
    const final = await other.fetch(
      new Request(`${origin}${path}`, { method, headers: { origin } }),
      {},
      {},
    );
    assert.equal(final.status, 200);
    assert.equal(await final.text(), "safe");
    const policies = final.headers.get("content-security-policy").split(/,\s*(?=default-src )/);
    assert.equal(policies.length, 2, `${method} ${path}: ${policies.join(" | ")}`);
    assert.equal(policies[0], supplied);
    assert.match(policies[1], /^default-src 'self';/);
    assert.match(policies[1], /frame-src https:\/\/checkout.stripe.com/);
    assert.doesNotMatch(policies[1], /frame-src 'self'|default-src \*/);
    assert.equal(final.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  }
});

test("final wrapper fails closed for Origin, Fetch Metadata, limiter and size without payload echo", async () => {
  for (const scenario of [
    "missing-origin",
    "null-origin",
    "same-site",
    "cross-site",
    "limited",
    "unavailable",
    "oversize",
  ]) {
    const server = serverFixture((req) =>
      send(
        req,
        scenario === "limited"
          ? async () => ({ allowed: false, status: "limited", retryAfter: 60 })
          : scenario === "unavailable"
            ? async () => ({ allowed: false, status: "unavailable", retryAfter: 60 })
            : allowed,
      ),
    );
    const req = request({
      filename: "PrivateName.md",
      bytes: encodeDocumentExportBytes(new TextEncoder().encode("PrivateBodyNeverEchoed")),
    });
    if (scenario === "missing-origin") req.headers.delete("origin");
    if (scenario === "null-origin") req.headers.set("origin", "null");
    if (scenario === "same-site" || scenario === "cross-site")
      req.headers.set("sec-fetch-site", scenario);
    if (scenario === "oversize")
      req.headers.set("content-length", String(MAX_DOCUMENT_EXPORT_FORM_BYTES + 1));
    const response = await server.fetch(req, {}, {});
    assert.equal(
      response.status,
      scenario === "limited"
        ? 429
        : scenario === "unavailable"
          ? 503
          : scenario === "oversize"
            ? 413
            : 403,
      scenario,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.doesNotMatch(await response.text(), /PrivateName|PrivateBodyNeverEchoed/);
  }
});
