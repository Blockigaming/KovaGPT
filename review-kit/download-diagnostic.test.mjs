import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import {
  DOWNLOAD_DIAGNOSTIC_PATH,
  DOWNLOAD_DIAGNOSTIC_TEXT,
  DOWNLOAD_DIAGNOSTIC_FILES,
  DOWNLOAD_DIAGNOSTIC_BYTES,
  DOWNLOAD_DIAGNOSTIC_SHA256,
  downloadDiagnosticPaths,
  downloadDiagnosticResponse,
  downloadDiagnosticScript,
  renderDownloadDiagnostic,
} from "./download-diagnostic.mjs";
import {
  BACKEND_PREFIX,
  createPrivateReviewServer,
  loadReviewPackage,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "99999999-9999-4999-8999-999999999999";
const origin = "http://127.0.0.1:4191";
const paths = downloadDiagnosticPaths(id);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const source = (file) => readFileSync(resolve(root, file), "utf8");
const response = (rawPath, overrides = {}) =>
  downloadDiagnosticResponse({
    url: new URL(rawPath, origin),
    rawPath,
    method: "GET",
    active: true,
    sessionId: id,
    ...overrides,
  });

test("the diagnostic has one exact fictional UTF-8 payload and three distinct fixed filenames", () => {
  assert.equal(
    DOWNLOAD_DIAGNOSTIC_TEXT,
    "Kova private download diagnostic\nFictional local sample only.\nUTF-8 sample: café · Δ · ✓\nNo account data, provider output or saved-file claim.\n",
  );
  assert.equal(DOWNLOAD_DIAGNOSTIC_BYTES, 149);
  assert.equal(
    DOWNLOAD_DIAGNOSTIC_SHA256,
    "01c54aa405cd8e72a9c4cfe5ce305e484c35a4358763cde918e39b7de8952099",
  );
  const result = response(paths.attachment);
  assert.ok(Buffer.isBuffer(result.body));
  assert.equal(hash(result.body), DOWNLOAD_DIAGNOSTIC_SHA256);
  assert.equal(result.contentType, "text/plain; charset=utf-8");
  assert.equal(result.headers["Content-Length"], "149");
  assert.equal(
    result.headers["Content-Disposition"],
    'attachment; filename="synthetic-http-attachment.txt"',
  );
  assert.deepEqual(Object.values(DOWNLOAD_DIAGNOSTIC_FILES), [
    "synthetic-mounted-blob.txt",
    "synthetic-direct-blob.txt",
    "synthetic-http-attachment.txt",
  ]);
  assert.ok(Object.isFrozen(DOWNLOAD_DIAGNOSTIC_FILES));
  const html = renderDownloadDiagnostic(id);
  assert.match(
    html,
    /<a id="mounted-blob-anchor"[^>]* hidden aria-hidden="true" tabindex="-1"><\/a>/,
  );
  assert.match(html, /<a id="direct-blob-link"[^>]*download="synthetic-direct-blob.txt"/);
  assert.ok(html.includes(`href="${paths.attachment}"`));
  assert.match(html, /cannot confirm that a file was saved/);
  assert.match(html, /Browser-level denials may produce no JavaScript event/);
  assert.doesNotMatch(html, /https?:\/\/|<iframe|<form|<script src=/);
});

test("only active matching-session exact read paths are handled, never query or body inputs", () => {
  for (const path of [paths.page, paths.attachment]) {
    assert.equal(response(path, { active: false }).status, 401);
    assert.equal(response(path, { sessionId: otherId }).status, 404);
    assert.equal(response(path + "?filename=other.txt").status, 400);
    assert.equal(response(path, { hasBody: true }).status, 400);
    assert.equal(response(path, { method: "HEAD" }).contentType, response(path).contentType);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      assert.equal(response(path, { method }).status, 405);
  }
  assert.equal(response(paths.attachment.replace("/sample.txt", "/unknown.txt")).status, 404);
  assert.equal(response(DOWNLOAD_DIAGNOSTIC_PATH).status, 404);
  assert.equal(response("/api/chat"), null);
  assert.throws(() => downloadDiagnosticPaths("../outside"), /session ID/);
  const bytes = response(paths.attachment).body;
  bytes[0] = 0;
  assert.equal(hash(response(paths.attachment).body), DOWNLOAD_DIAGNOSTIC_SHA256);
});

function scriptHarness({ blobFails = false, clickFails = false } = {}) {
  const handlers = {},
    urls = [],
    revoked = [],
    attempts = [];
  const nodes = Object.fromEntries(
    [
      "blob-button",
      "mounted-blob-anchor",
      "direct-blob-link",
      "http-attachment-link",
      "button-status",
      "link-status",
      "http-status",
      "browser-errors",
    ].map((name) => [
      name,
      {
        textContent: "",
        attrs: {},
        listeners: {},
        children: [],
        addEventListener(event, handler) {
          this.listeners[event] = handler;
        },
        set href(value) {
          this.attrs.href = value;
        },
        get href() {
          return this.attrs.href;
        },
        setAttribute(key, value) {
          this.attrs[key] = value;
        },
        removeAttribute(key) {
          delete this.attrs[key];
        },
        append(row) {
          this.children.push(row);
          row.remove = () => this.children.splice(this.children.indexOf(row), 1);
        },
        get firstElementChild() {
          return this.children[0];
        },
        click() {
          assert.equal(name, "mounted-blob-anchor");
          if (clickFails) throw new Error("Synthetic anchor click failure");
          attempts.push(this.href);
        },
      },
    ]),
  );
  const context = {
    window: {
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
    },
    document: {
      getElementById(name) {
        assert.ok(nodes[name]);
        return nodes[name];
      },
      createElement(name) {
        assert.equal(name, "li");
        return { textContent: "" };
      },
    },
    Blob: class {
      constructor(parts, options) {
        if (blobFails) throw new Error("Synthetic Blob failure");
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.parts[0], DOWNLOAD_DIAGNOSTIC_TEXT);
        assert.equal(blob.options.type, "text/plain;charset=utf-8");
        const url = "blob:synthetic-" + (urls.length + 1);
        urls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  };
  runInNewContext(downloadDiagnosticScript(), context);
  return { nodes, handlers, urls, revoked, attempts };
}

test("preparation never downloads; button activation uses its mounted anchor while direct and HTTP links remain native", () => {
  const { nodes, handlers, urls, revoked, attempts } = scriptHarness();
  assert.equal(urls.length, 1);
  assert.deepEqual(attempts, []);
  assert.equal(nodes["direct-blob-link"].href, urls[0]);
  const native = {
    preventDefault() {
      assert.fail("Valid link activation must remain native");
    },
  };
  nodes["direct-blob-link"].listeners.click(native);
  nodes["http-attachment-link"].listeners.click(native);
  assert.deepEqual(attempts, []);
  nodes["blob-button"].listeners.click();
  nodes["blob-button"].listeners.click();
  assert.equal(urls.length, 2);
  assert.deepEqual(attempts, [urls[1], urls[1]]);
  assert.match(nodes["button-status"].textContent, /saved output is unknown/);
  assert.match(nodes["http-status"].textContent, /cannot confirm request arrival or a saved file/);
  assert.deepEqual(revoked, []);
  handlers.pagehide();
  assert.deepEqual(revoked, [urls[1], urls[0]]);
  assert.equal(nodes["direct-blob-link"].href, undefined);
  assert.equal(nodes["mounted-blob-anchor"].href, undefined);
  handlers.pageshow({ persisted: true });
  assert.equal(urls.length, 3);
  assert.equal(nodes["direct-blob-link"].href, urls[2]);
  assert.equal(attempts.length, 2);
  assert.doesNotMatch(
    downloadDiagnosticScript(),
    /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|window\.open|permissions|prototype|setTimeout|preventDefault\(\).*http/,
  );
});

test("synchronous and delivered browser errors are shown safely and bounded, without claiming saved output", () => {
  const failed = scriptHarness({ blobFails: true });
  assert.equal(failed.nodes["direct-blob-link"].href, undefined);
  let prevented = 0;
  failed.nodes["direct-blob-link"].listeners.click({
    preventDefault() {
      prevented += 1;
    },
  });
  assert.equal(prevented, 1);
  failed.nodes["blob-button"].listeners.click();
  assert.match(failed.nodes["button-status"].textContent, /Synthetic Blob failure/);
  assert.equal(failed.attempts.length, 0);
  const clickFailed = scriptHarness({ clickFails: true });
  clickFailed.nodes["blob-button"].listeners.click();
  assert.match(clickFailed.nodes["button-status"].textContent, /Synthetic anchor click failure/);
  const { nodes, handlers } = scriptHarness();
  handlers.error({ message: "<script>display text only</script>" });
  assert.match(nodes["browser-errors"].children[0].textContent, /<script>display text only/);
  handlers.unhandledrejection({ reason: new Error("Synthetic rejection") });
  handlers.securitypolicyviolation({
    effectiveDirective: "default-src",
    disposition: "enforce",
    blockedURI: "must-not-log-this",
  });
  assert.equal(nodes["browser-errors"].children.length, 3);
  assert.doesNotMatch(nodes["browser-errors"].children[2].textContent, /must-not-log/);
  for (let index = 0; index < 20; index++) handlers.error({ message: "Bounded error " + index });
  assert.equal(nodes["browser-errors"].children.length, 10);
  assert.match(nodes["browser-errors"].children[9].textContent, /Bounded error 19/);
});

test("private HTTP routes preserve active-session, cross-site, method and security-header guards with zero upstream calls", async () => {
  assert.ok(
    process.env.KOVA_REVIEW_PACKAGE,
    "Set KOVA_REVIEW_PACKAGE to an existing review package",
  );
  const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
  const port = 4791;
  const review = createPrivateReviewServer({
    pkg,
    port,
    fetchImpl: async () => assert.fail("No diagnostic request may reach upstream"),
  });
  const local = (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolveResponse, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      });
      req.on("error", reject);
      req.end(body);
    });
  try {
    await review.listen();
    const controls = await local("/__local-review");
    const csrf = /name="csrf" value="([^"]+)"/.exec(controls.body.toString())[1];
    const formCookie = controls.headers["set-cookie"][0].split(";")[0];
    let cookie = "";
    const open = async (account) => {
      const body = new URLSearchParams({
        csrf,
        account,
        scenario: "default",
        state: "populated",
        theme: "dark",
        path: "/",
        size: "phone",
      }).toString();
      const opened = await local("/__local-review/start", {
        method: "POST",
        headers: {
          origin: review.origin,
          cookie: [formCookie, cookie].filter(Boolean).join("; "),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
        body,
      });
      assert.equal(opened.status, 200);
      cookie = opened.headers["set-cookie"][0].split(";")[0];
      const sessionId = cookie.split("=")[1];
      const current = downloadDiagnosticPaths(sessionId);
      assert.ok(
        opened.body
          .toString()
          .includes(
            `href="${current.page}" target="_blank" rel="noopener noreferrer">Synthetic download diagnostic`,
          ),
      );
      return current;
    };
    assert.equal((await local(paths.page)).status, 401);
    assert.equal((await local(paths.attachment)).status, 401);
    for (const account of ["guest", "free", "plus", "pro"]) {
      const current = await open(account);
      const headers = { cookie };
      const page = await local(current.page, { headers });
      const file = await local(current.attachment, { headers });
      assert.equal(page.status, 200);
      assert.equal(file.status, 200);
      assert.equal(hash(file.body), DOWNLOAD_DIAGNOSTIC_SHA256);
      assert.equal(
        file.headers["content-disposition"],
        'attachment; filename="synthetic-http-attachment.txt"',
      );
      assert.equal(file.headers["content-length"], "149");
      for (const key of [
        "content-security-policy",
        "permissions-policy",
        "cache-control",
        "x-content-type-options",
        "referrer-policy",
        "x-kova-private-review",
      ]) {
        assert.equal(page.headers[key], controls.headers[key], key);
        assert.equal(file.headers[key], controls.headers[key], key);
      }
      assert.equal((await local(current.attachment, { headers, method: "HEAD" })).body.length, 0);
      assert.equal((await local(current.attachment + "?text=other", { headers })).status, 400);
      assert.equal(
        (
          await local(current.attachment, {
            headers: { ...headers, "content-length": "2" },
            body: "{}",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await local(current.attachment, {
            headers: { ...headers, "sec-fetch-site": "cross-site" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await local(current.attachment, { headers: { ...headers, host: "outside.invalid" } }))
          .status,
        403,
      );
      assert.equal((await local(current.attachment, { method: "POST", headers })).status, 403);
      assert.equal(
        (
          await local(current.attachment, {
            method: "POST",
            headers: { ...headers, origin: review.origin },
          })
        ).status,
        405,
      );
      const oldCookie = cookie;
      await open(account);
      assert.equal((await local(current.page, { headers: { cookie: oldCookie } })).status, 401);
      assert.equal((await local(current.attachment, { headers: { cookie } })).status, 404);
    }
    const current = await open("pro");
    const logout = await local(BACKEND_PREFIX + "/auth/v1/logout", {
      method: "POST",
      headers: { origin: review.origin, cookie },
    });
    assert.equal(logout.status, 204);
    assert.equal((await local(current.page, { headers: { cookie } })).status, 401);
    assert.equal((await local(current.attachment, { headers: { cookie } })).status, 401);
  } finally {
    review.dispose();
    if (review.server.listening) {
      review.server.closeAllConnections();
      await new Promise((done) => review.server.close(done));
    }
  }
});

test("portable packaging includes only the self-contained diagnostic helper alongside the adapter", async () => {
  assert.match(source("review-kit/package.mjs"), /"download-diagnostic\.mjs"/);
  assert.match(source("review-kit/private-http-review.mjs"), /from "\.\/download-diagnostic\.mjs"/);
  const result = await build({
    entryPoints: [resolve(root, "review-kit/download-diagnostic.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  assert.doesNotMatch(result.outputFiles[0].text, /\.\.\/src|playwright|puppeteer/);
  assert.ok(result.outputFiles[0].text.includes(DOWNLOAD_DIAGNOSTIC_PATH));
});
