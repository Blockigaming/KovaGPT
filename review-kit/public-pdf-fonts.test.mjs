import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request } from "node:http";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  REVIEW_PDF_FONTS,
  BACKEND_PREFIX,
  packagedPdfFont,
  createPrivateReviewServer,
} from "./private-http-review.mjs";

const packageRoot = process.env.KOVA_REVIEW_PACKAGE;
assert.ok(packageRoot, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const clientRoot = resolve(packageRoot, "dist/client");
const source = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("the two exact allowlisted files match the source fonts and packaged PDF exporter references", () => {
  assert.equal(REVIEW_PDF_FONTS.length, 2);
  assert.ok(Object.isFrozen(REVIEW_PDF_FONTS));
  assert.match(source("src/lib/writing-export/pdf.ts"), /credentials: "omit"/);
  const assets = readdirSync(join(clientRoot, "assets"));
  const exporters = assets
    .filter((name) => /^pdf-[A-Za-z0-9_-]+\.js$/.test(name))
    .map((name) => readFileSync(join(clientRoot, "assets", name), "utf8"))
    .join("\n");
  for (const font of REVIEW_PDF_FONTS) {
    assert.ok(exporters.includes(font.path.split("/").at(-1)));
    const bytes = packagedPdfFont(clientRoot, font.path);
    assert.equal(bytes.length, font.bytes);
    assert.equal(sha256(bytes), font.sha256);
    const name = font.path.includes("Bold") ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
    assert.deepEqual(
      bytes,
      readFileSync(new URL("../src/assets/document-fonts/" + name, import.meta.url)),
    );
  }
});

test("font reader fails closed for missing, changed, directory, symlink escape and unknown paths", () => {
  const temp = mkdtempSync(join(tmpdir(), "kova-public-font-test-"));
  try {
    const root = join(temp, "client");
    mkdirSync(join(root, "assets"), { recursive: true });
    const font = REVIEW_PDF_FONTS[0];
    const destination = join(root, font.path);
    assert.equal(packagedPdfFont(root, font.path), null);
    mkdirSync(destination);
    assert.equal(packagedPdfFont(root, font.path), null);
    rmSync(destination, { recursive: true });
    const original = packagedPdfFont(clientRoot, font.path);
    const changed = Buffer.from(original);
    changed[100] ^= 1;
    writeFileSync(destination, changed);
    assert.equal(packagedPdfFont(root, font.path), null);
    writeFileSync(destination, "not a font");
    assert.equal(packagedPdfFont(root, font.path), null);
    rmSync(destination);
    const outside = join(temp, "outside.ttf");
    writeFileSync(outside, original);
    symlinkSync(outside, destination);
    assert.equal(packagedPdfFont(root, font.path), null);
    rmSync(destination);
    copyFileSync(join(clientRoot, font.path), destination);
    assert.deepEqual(packagedPdfFont(root, font.path), original);
    for (const path of [
      "/assets/other.ttf",
      "/api/private-files",
      font.path + "?x=1",
      "/assets/../" + font.path,
      "/assets/%44ejaVuSans-uCh15Ap1.ttf",
      "../../outside.ttf",
    ])
      assert.equal(packagedPdfFont(root, path), null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("cookieless HTTP reads serve only the two exact fonts, preserving Host, origin, service and method guards", async () => {
  const port = 4783;
  const review = createPrivateReviewServer({
    pkg: { root: packageRoot, source: { commit: "font-test", buildCommit: "font-test" } },
    port,
    fetchImpl: async () => assert.fail("Font reads must never reach upstream or a provider"),
  });
  const local = (path, { method = "GET", headers = {} } = {}) =>
    new Promise((resolveResponse, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  try {
    await review.listen();
    for (const font of REVIEW_PDF_FONTS) {
      const result = await local(font.path);
      assert.equal(result.status, 200);
      assert.equal(result.headers["content-type"], "font/ttf");
      assert.equal(result.headers["x-content-type-options"], "nosniff");
      assert.equal(result.headers["cache-control"], "no-store");
      assert.equal(result.headers["set-cookie"], undefined);
      assert.equal(result.body.length, font.bytes);
      assert.equal(sha256(result.body), font.sha256);
      const head = await local(font.path, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers["content-type"], "font/ttf");
      assert.equal(head.body.length, 0);
      assert.equal((await local(font.path + "?download=1")).status, 400);
      assert.equal((await local("/assets/../" + font.path.slice(1))).status, 400);
      assert.equal((await local(font.path, { headers: { host: "outside.invalid" } })).status, 403);
      assert.equal(
        (await local(font.path, { headers: { "sec-fetch-site": "cross-site" } })).status,
        403,
      );
      for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
        assert.equal((await local(font.path, { method })).status, 403);
        assert.equal(
          (await local(font.path, { method, headers: { origin: review.origin } })).status,
          405,
        );
      }
    }
    for (const path of [
      "/assets/other.ttf",
      "/assets/DejaVuSans-unlisted.ttf",
      "/assets/%44ejaVuSans-uCh15Ap1.ttf",
      "/api/chat/history",
      "/api/private-files?id=example",
      "/api/library/items",
      "/_serverFn/example",
      BACKEND_PREFIX + "/auth/v1/user",
    ])
      assert.equal((await local(path)).status, 401, path);
  } finally {
    review.dispose();
    if (review.server.listening) {
      review.server.closeAllConnections();
      await new Promise((resolveClose) => review.server.close(resolveClose));
    }
  }
});
