import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createSiteAssetHandler } from "../../sites-server/handler.mjs";
import {
  inspectSiteFiles,
  siteHostingConfig,
  sha256,
  sitePath,
} from "../../src/lib/sites-policy.mjs";
const site = "123e4567-e89b-42d3-a456-426614174000";
const env = {
  KOVA_SITES_HOSTING_ENABLED: "true",
  KOVA_SITES_ISOLATION_APPROVED: "true",
  KOVA_SITES_APP_ORIGIN: "https://kovagpt.test",
  KOVA_SITES_ASSET_ORIGIN: "https://kova-pages.test",
};
const origin = `https://${site}.kova-pages.test`;
function handler(result) {
  const calls = [];
  return {
    calls,
    run: createSiteAssetHandler({
      env,
      admin: {
        async rpc(name, args) {
          calls.push({ name, args });
          return { data: typeof result === "function" ? result(name, args) : result, error: null };
        },
      },
    }),
  };
}

test("generated content is never served on the application, shared root, or unconfigured origin", async () => {
  assert.equal(siteHostingConfig({}), null);
  for (const asset of [
    "https://kovagpt.test",
    "https://sites.kovagpt.test",
    "https://other.kovagpt.test",
    "http://kova-pages.test",
    "https://user:secret@kova-pages.test",
  ]) {
    assert.equal(siteHostingConfig({ ...env, KOVA_SITES_ASSET_ORIGIN: asset }), null);
  }
  const h = handler(null);
  for (const host of [
    "https://kovagpt.test",
    "https://kova-pages.test",
    "https://attacker.example",
    "https://not-a-uuid.kova-pages.test",
  ]) {
    assert.equal(
      (
        await h.run(
          new Request(host + "/example/index.html", {
            headers: { "x-forwarded-host": site + ".kova-pages.test" },
          }),
        )
      ).status,
      404,
    );
  }
  assert.equal(h.calls.length, 0);
  const disabled = createSiteAssetHandler({
    admin: {
      rpc() {
        assert.fail();
      },
    },
    env: {},
  });
  assert.equal((await disabled(new Request(origin + "/example/"))).status, 404);
});

test("the actual ticket bootstrap script compiles and redeems after clearing its fragment", async () => {
  const h = handler(null),
    response = await h.run(new Request(origin + "/__kova/access"));
  assert.equal(response.status, 200);
  const html = await response.text(),
    script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const events = [],
    token = "a".repeat(64);
  const context = {
    location: {
      hash: "#" + token,
      pathname: "/__kova/access",
      replace: (path) => events.push(["redirect", path]),
    },
    history: { replaceState: () => events.push(["clear"]) },
    document: { body: { textContent: "" } },
    fetch: async (path, options) => {
      events.push(["redeem", path, JSON.parse(options.body)]);
      return { ok: true, json: async () => ({ path: "/example/" }) };
    },
  };
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, [
    ["clear"],
    ["redeem", "/__kova/session", { token }],
    ["redirect", "/example/"],
  ]);
  assert.match(response.headers.get("content-security-policy"), /script-src 'sha256-/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("ticket redemption requires the exact isolated origin and issues only a secure host cookie", async () => {
  const h = handler({ slug: "example" }),
    body = JSON.stringify({ token: "a".repeat(64) });
  const invalid = await h.run(
    new Request(origin + "/__kova/session", {
      method: "POST",
      headers: { origin: "https://kovagpt.test", "content-type": "application/json" },
      body,
    }),
  );
  assert.equal(invalid.status, 403);
  assert.equal(h.calls.length, 0);
  const valid = await h.run(
    new Request(origin + "/__kova/session", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body,
    }),
  );
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie");
  assert.match(
    cookie,
    /^__Host-kova-site=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=900$/,
  );
  assert.ok(!cookie.includes("Domain="));
  assert.equal(h.calls[0].name, "redeem_kova_site_ticket");
  assert.notEqual(h.calls[0].args.p_ticket_hash, "a".repeat(64));
});

test("asset responses enforce snapshot bytes, exact MIME, CSP isolation, and no cross-origin grants", async () => {
  const content = "<script>window.generated=true</script>",
    data = {
      base64: btoa(content),
      sha256: await sha256(content),
      size: content.length,
      type: "text/html",
    };
  const h = handler(data),
    response = await h.run(new Request(origin + "/example/"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), content);
  assert.match(response.headers.get("content-security-policy"), /worker-src 'none'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  for (const bad of [
    { ...data, sha256: "0".repeat(64) },
    { ...data, type: "application/json" },
    { ...data, size: data.size + 1 },
  ])
    assert.equal((await handler(bad).run(new Request(origin + "/example/"))).status, 503);
});

test("file admission rejects duplicate, unsupported, traversing and oversized inputs before storage", async () => {
  for (const path of [
    "../index.html",
    "nested/../index.html",
    "/index.html",
    "__kova/access.html",
    "foo//bar.js",
    "index.php",
    "a b.html",
  ]) {
    assert.throws(() => sitePath(path));
  }
  await assert.rejects(
    inspectSiteFiles([{ path: "app.js", base64: btoa("hello") }]),
    /index_required/,
  );
  await assert.rejects(inspectSiteFiles([{ path: "index.html", base64: "bad!" }]), /invalid/);
  await assert.rejects(
    inspectSiteFiles([
      { path: "index.html", base64: "" },
      { path: "INDEX.HTML", base64: "" },
    ]),
    /duplicate/,
  );
  const files = await inspectSiteFiles([
    { path: "index.html", base64: btoa("one") },
    { path: "app.js", base64: btoa("two") },
  ]);
  assert.equal(files.bytes, 6);
  assert.equal(files.files[0].path, "app.js");
  assert.match(files.manifestSha256, /^[a-f0-9]{64}$/);
});
