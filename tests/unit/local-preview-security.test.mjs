import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/lib/local-preview-security.server.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { applyLocalPreviewTransportPolicy } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const csp = "default-src 'self'; script-src 'self' 'nonce-test'; upgrade-insecure-requests";
const hsts = "max-age=63072000; includeSubDomains; preload";
function headers() {
  return new Headers({
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": hsts,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  });
}

for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
  test(`explicit HTTP preview permits ${host} without relaxing other CSP directives`, () => {
    const value = headers();
    applyLocalPreviewTransportPolicy(value, new Request(`http://${host}:8094/`), {
      KOVA_LOCAL_HTTP_PREVIEW: "1",
      NODE_ENV: "production",
    });
    assert.equal(
      value.get("Content-Security-Policy"),
      "default-src 'self'; script-src 'self' 'nonce-test'",
    );
    assert.equal(value.has("Strict-Transport-Security"), false);
    assert.equal(value.get("X-Content-Type-Options"), "nosniff");
    assert.equal(value.get("X-Frame-Options"), "SAMEORIGIN");
  });
}

for (const url of [
  "https://127.0.0.1:8094/",
  "https://localhost/",
  "https://kovagpt.com/",
  "http://kovagpt.com/",
  "http://localhost.attacker.test/",
  "http://127.0.0.1.attacker.test/",
  "http://0.0.0.0:8094/",
]) {
  test(`security headers remain unchanged for ${url}`, () => {
    const value = headers();
    const original = [...value];
    applyLocalPreviewTransportPolicy(value, new Request(url), { KOVA_LOCAL_HTTP_PREVIEW: "1" });
    assert.deepEqual([...value], original);
  });
}

for (const flag of [undefined, "", "0", "true"]) {
  test(`loopback requires the exact server opt-in, not ${String(flag)}`, () => {
    const value = headers();
    applyLocalPreviewTransportPolicy(value, new Request("http://127.0.0.1:8094/"), {
      KOVA_LOCAL_HTTP_PREVIEW: flag,
    });
    assert.equal(value.get("Content-Security-Policy"), csp);
    assert.equal(value.get("Strict-Transport-Security"), hsts);
  });
}

for (const marker of [
  { KOVA_RUNTIME_PLATFORM: "azure-container-apps" },
  { CONTAINER_APP_NAME: "kova-production" },
  { CONTAINER_APP_REVISION: "kova-production--revision" },
  { WEBSITE_INSTANCE_ID: "hosted-instance" },
]) {
  test(`hosted runtime rejects a local preview opt-in: ${Object.keys(marker)[0]}`, () => {
    const value = headers();
    const original = [...value];
    applyLocalPreviewTransportPolicy(value, new Request("http://127.0.0.1:8094/"), {
      KOVA_LOCAL_HTTP_PREVIEW: "1",
      ...marker,
    });
    assert.deepEqual([...value], original);
  });
}

test("request headers and query parameters cannot enable the preview exception", () => {
  const value = headers();
  const request = new Request("http://127.0.0.1:8094/?KOVA_LOCAL_HTTP_PREVIEW=1", {
    headers: { KOVA_LOCAL_HTTP_PREVIEW: "1", "X-Forwarded-Host": "localhost" },
  });
  applyLocalPreviewTransportPolicy(value, request, {});
  assert.equal(value.get("Content-Security-Policy"), csp);
  assert.equal(value.get("Strict-Transport-Security"), hsts);
});

test("normalizing a loopback policy is idempotent", () => {
  const value = headers();
  const request = new Request("http://127.0.0.1:8094/");
  const env = { KOVA_LOCAL_HTTP_PREVIEW: "1" };
  applyLocalPreviewTransportPolicy(value, request, env);
  const once = [...value];
  applyLocalPreviewTransportPolicy(value, request, env);
  assert.deepEqual([...value], once);
});

for (const [path, functionName] of [
  ["src/start.ts", "applySecurityHeaders"],
  ["src/server.ts", "hardenResponse"],
]) {
  test(`${path} applies the policy and threads the request through every response path`, () => {
    const text = readFileSync(path, "utf8");
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    let calls = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === functionName) {
        calls += 1;
        assert.equal(node.arguments.length, 2);
        assert.equal(node.arguments[1].getText(file), "request");
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(calls, 4);
    assert.match(text, /applyLocalPreviewTransportPolicy\(headers, request\)/u);
    assert.match(text, /"upgrade-insecure-requests"/u);
    assert.match(text, /"Strict-Transport-Security"/u);
  });
}
