import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import * as catalog from "./review-state-fixtures.mjs";
import { createPrivateReviewServer, loadReviewPackage } from "./private-http-review.mjs";
import {
  createReviewDocumentExport,
  DOCUMENT_EXPORT_PATH,
} from "./document-export-review-transport.mjs";
import {
  MAX_DOCUMENT_EXPORT_FORM_BYTES,
  encodeDocumentExportBytes,
} from "../src/lib/document-export-policy.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const sample = Buffer.from(
  "Fictional local export. Café Δ ✓\nhttps://mfbycmbjygcfkrsuepxf.supabase.co\n",
);
const form = (bytes = sample) =>
  new URLSearchParams({
    format: "md",
    filename: "fictional-review.md",
    bytes: encodeDocumentExportBytes(bytes),
  });
let port = 4810;
async function withServer(run) {
  const review = createPrivateReviewServer({
    pkg,
    port: port++,
    fetchImpl: async () => assert.fail("No export request may reach upstream"),
  });
  try {
    await review.listen();
    await run(review);
  } finally {
    review.dispose();
    review.server.closeAllConnections();
    await new Promise((resolve) => review.server.close(resolve));
  }
}
async function start(review, account = "guest", previousCookie = "") {
  const controls = await fetch(review.origin + "/__local-review", {
    headers: previousCookie ? { cookie: previousCookie } : {},
  });
  const cookie = controls.headers.get("set-cookie").split(";")[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await controls.text())[1];
  const response = await fetch(review.origin + "/__local-review/start", {
    method: "POST",
    headers: { origin: review.origin, cookie: [cookie, previousCookie].filter(Boolean).join("; ") },
    body: new URLSearchParams({
      csrf,
      account,
      theme: "dark",
      path: "/",
      size: "desktop",
      state: "populated",
      scenario: "default",
    }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Use fictional review content only/);
  return response.headers.get("set-cookie").split(";")[0];
}
const post = (review, cookie, options = {}) =>
  fetch(review.origin + DOCUMENT_EXPORT_PATH, {
    method: "POST",
    body: form(),
    ...options,
    headers: { origin: review.origin, ...(cookie ? { cookie } : {}), ...options.headers },
  });
function raw(review, cookie, { body = "", headers = {}, finish = true } = {}) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = httpRequest(
      review.origin + DOCUMENT_EXPORT_PATH,
      {
        method: "POST",
        headers: {
          origin: review.origin,
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        res.on("error", reject);
      },
    );
    request.on("error", reject);
    request.write(body);
    if (finish) request.end();
  });
  return { request, response };
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(setImmediate);
  assert.ok(predicate(), "Expected bounded native request lifecycle transition");
}

test("native Guest and signed-in review relay exact submitted bytes and restrictive production headers without upstream or text rewriting", async () => {
  await withServer(async (review) => {
    for (const account of ["guest", "pro"]) {
      const cookie = await start(review, account);
      const result = await post(review, cookie);
      assert.equal(result.status, 200);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), sample);
      assert.equal(
        result.headers.get("content-disposition"),
        "attachment; filename*=UTF-8''fictional-review.md",
      );
      assert.equal(result.headers.get("content-length"), String(sample.length));
      assert.equal(result.headers.get("content-type"), "text/plain;charset=utf-8");
      assert.equal(result.headers.get("content-security-policy"), "default-src 'none'; sandbox");
      assert.equal(result.headers.get("referrer-policy"), "no-referrer");
      assert.equal(result.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal(result.headers.get("x-content-type-options"), "nosniff");
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.headers.get("x-kova-private-review"), "synthetic-only");
      assert.equal(
        result.headers.get("permissions-policy"),
        "camera=(), microphone=(), geolocation=(), payment=()",
      );
    }
  });
});

test("actual adapter retains session, exact Origin/URL, fetch-site, method and form bounds", async () => {
  await withServer(async (review) => {
    assert.equal((await post(review)).status, 401);
    const cookie = await start(review);
    for (const origin of ["https://outside.invalid", "null", "http://127.0.0.1:4189", ""]) {
      const result = await post(review, cookie, { headers: { origin } });
      assert.equal(result.status, 403);
      assert.equal(result.headers.has("content-disposition"), false);
    }
    const noOrigin = await fetch(review.origin + DOCUMENT_EXPORT_PATH, {
      method: "POST",
      headers: { cookie },
      body: form(),
    });
    assert.equal(noOrigin.status, 403);
    for (const site of ["cross-site", "same-site"])
      assert.equal(
        (await post(review, cookie, { headers: { "sec-fetch-site": site } })).status,
        403,
      );
    assert.equal(
      (await fetch(review.origin + DOCUMENT_EXPORT_PATH, { headers: { cookie } })).status,
      405,
    );
    assert.equal(
      (
        await fetch(review.origin + DOCUMENT_EXPORT_PATH + "?extra=1", {
          method: "POST",
          headers: { origin: review.origin, cookie },
          body: form(),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(review, cookie, {
          body: "not a form",
          headers: { "content-type": "text/plain" },
        })
      ).status,
      415,
    );
    const extra = form();
    extra.set("account", "unused");
    const result = await post(review, cookie, { body: extra });
    assert.equal(result.status, 400);
    assert.doesNotMatch(await result.text(), /unused|Fictional local export/);
  });
});

test("actual relay uses its bounded native stream, rejects declared and chunked oversize, and remains available", async () => {
  await withServer(async (review) => {
    const cookie = await start(review);
    const larger = Buffer.alloc(600_000, 65);
    const result = await post(review, cookie, { body: form(larger) });
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), larger);
    const declared = raw(review, cookie, {
      body: "format=md&",
      headers: { "content-length": String(MAX_DOCUMENT_EXPORT_FORM_BYTES + 1) },
      finish: false,
    });
    assert.equal((await declared.response).status, 413);
    declared.request.destroy();
    const chunked = raw(review, cookie, { body: "a".repeat(MAX_DOCUMENT_EXPORT_FORM_BYTES + 1) });
    assert.equal((await chunked.response).status, 413);
    const after = await post(review, cookie);
    assert.equal(after.status, 200);
    assert.deepEqual(Buffer.from(await after.arrayBuffer()), sample);
    // Existing unrelated API cap is unchanged; this route bypasses that reader
    // only to use the real parser's tighter envelope and request timeout.
    const source = readFileSync(join(root, "review-kit/private-http-review.mjs"), "utf8");
    assert.match(source, /const maxBodyBytes = 11 \* 1024 \* 1024/);
    const branch = source.slice(
      source.indexOf("if (url.pathname === DOCUMENT_EXPORT_PATH)"),
      source.indexOf('if (url.pathname === "/api/chat" && (session.chatStream'),
    );
    assert.doesNotMatch(branch, /readBody\(|registry\.dispatch|fetchImpl/);
  });
});

test("native delivery limit is ten attempts, session-isolated and reset/logout close previous delivery access", async () => {
  await withServer(async (review) => {
    const cookie = await start(review, "pro");
    for (let index = 0; index < 10; index++) {
      const result = await post(review, cookie);
      assert.equal(result.status, 200);
      await result.arrayBuffer();
    }
    const limited = await post(review, cookie);
    assert.equal(limited.status, 429);
    assert.ok(
      Number(limited.headers.get("retry-after")) >= 1 &&
        Number(limited.headers.get("retry-after")) <= 60,
    );
    assert.equal(limited.headers.has("content-disposition"), false);
    const next = await start(review, "guest");
    assert.equal((await post(review, next)).status, 200);
    const signedOut = await fetch(review.origin + "/__private-review/backend/auth/v1/logout", {
      method: "POST",
      headers: { origin: review.origin, cookie },
    });
    assert.equal(signedOut.status, 204);
    assert.equal((await post(review, cookie)).status, 401);
    const reset = await start(review, "guest", next);
    assert.equal((await post(review, next)).status, 401);
    assert.equal((await post(review, reset)).status, 200);
    const changedAccount = await start(review, "pro", reset);
    assert.equal((await post(review, reset)).status, 401);
    assert.equal((await post(review, changedAccount)).status, 200);
    review.dispose();
    assert.equal((await post(review, changedAccount)).status, 401);
  });
});

test("aborted and session-disposed native bodies release pending work without producing an attachment", async () => {
  await withServer(async (review) => {
    const cookie = await start(review);
    const session = [...review.sessions.values()][0];
    const interrupted = raw(review, cookie, { body: "format=md&", finish: false });
    const rejected = assert.rejects(interrupted.response);
    await until(() => session.documentExport.pendingCount === 1);
    interrupted.request.destroy(new Error("Synthetic client cancellation"));
    await rejected;
    await until(() => session.documentExport.pendingCount === 0);
    const reset = raw(review, cookie, { body: "format=md&", finish: false });
    await until(() => session.documentExport.pendingCount === 1);
    session.dispose();
    const result = await reset.response;
    assert.equal(result.status, 401);
    assert.equal(result.headers["content-disposition"], undefined);
    assert.equal(session.documentExport.pendingCount, 0);
    reset.request.destroy();
  });
});

test("disposable limiter has bounded rollover, inactive cleanup and portable production-parser bundling", async () => {
  let time = 1000;
  const delivery = createReviewDocumentExport({ isActive: () => true, now: () => time });
  const request = () =>
    new Request("http://127.0.0.1:4191" + DOCUMENT_EXPORT_PATH, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4191" },
      body: form(),
    });
  for (let index = 0; index < 10; index++)
    assert.equal((await delivery.handle(request())).status, 200);
  assert.equal((await delivery.handle(request())).status, 429);
  time += 60_000;
  assert.equal((await delivery.handle(request())).status, 200);
  delivery.dispose();
  assert.equal((await delivery.handle(request())).status, 401);
  assert.equal(delivery.pendingCount, 0);
  const packaging = readFileSync(join(root, "review-kit/package.mjs"), "utf8");
  assert.match(packaging, /"document-export-review-transport\.mjs"/);
  const bundled = await build({
    entryPoints: [join(root, "review-kit/document-export-review-transport.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const source = bundled.outputFiles[0].text;
  assert.match(source, /function handleDocumentExportDelivery/);
  assert.doesNotMatch(source, /from ["']\.\.\/src\//);
  assert.doesNotMatch(source, /consumeApplicationRateLimit|supabase|fetch\(/);
  const portable = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  const packaged = portable.createReviewDocumentExport({ isActive: () => true });
  const delivered = await packaged.handle(request());
  assert.equal(delivered.status, 200);
  assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), sample);
  packaged.dispose();
});
