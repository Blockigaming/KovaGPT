import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { siteHostingConfig } from "../../src/lib/sites-policy.mjs";

const source = await readFile("src/lib/sites-hosting.server.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import .*;\n/gmu, "").replace(/^export /gmu, ""),
  {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const env = {
  KOVA_SITES_HOSTING_ENABLED: "true",
  KOVA_SITES_ISOLATION_APPROVED: "true",
  KOVA_SITES_APP_ORIGIN: "https://kovagpt.test",
  KOVA_SITES_ASSET_ORIGIN: "https://kova-pages.test",
};
function fresh() {
  const context = { siteHostingConfig, AbortController, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(compiled + "\nglobalThis.ready = readySiteHosting", context);
  return context.ready;
}
test("publication readiness requires the dedicated host contract and never follows redirects", async () => {
  const ready = fresh();
  assert.equal(await ready({}, () => assert.fail("unconfigured host must not fetch")), null);
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, "https://kova-pages.test/health");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ ok: true, service: "kova-sites-assets" });
  };
  assert.equal((await ready(env, fetcher)).assetHost, "kova-pages.test");
  assert.equal((await ready(env, fetcher)).assetHost, "kova-pages.test");
  assert.equal(calls, 1);
  assert.equal(await ready({ ...env, KOVA_SITES_HOSTING_ENABLED: "false" }, fetcher), null);
});
test("unavailable, unrelated, redirecting and oversized hosts cannot enable publishing", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    Response.json({ ok: true, service: "application" }),
    new Response("a".repeat(1025)),
    new Response("<html>Not a health contract</html>"),
  ])
    assert.equal(await fresh()(env, async () => response), null);
  assert.equal(
    await fresh()(env, async () => {
      throw new TypeError("redirect disallowed");
    }),
    null,
  );
});
