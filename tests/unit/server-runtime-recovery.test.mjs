import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a failed server-entry import is not cached for the Worker isolate lifetime", () => {
  const source = read("src/server.ts");
  assert.match(source, /const pending = import\("@tanstack\/react-start\/server-entry"\)/);
  assert.match(source, /if \(serverEntryPromise === pending\) serverEntryPromise = undefined/);
  assert.doesNotMatch(source, /consumeLastCapturedError|\.\/lib\/error-capture/);
  assert.doesNotMatch(source, /h3 swallowed SSR error: \$\{body\}/);
});

test("the public health route exposes only its allowlisted KovaGPT status", () => {
  const source = read("src/routes/api/health.ts");
  assert.match(
    source,
    /Response\.json\(\s*\{[\s\S]*status: "ok",[\s\S]*service: "kovagpt-web",[\s\S]*environment:[\s\S]*timestamp:/,
  );
  assert.match(source, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(source, /safeDiagnostics|diagnostics\.server/);
  assert.doesNotMatch(
    source,
    /secret|token|credential|service[_-]?role|api[_-]?key|commit|branch/i,
  );
});
