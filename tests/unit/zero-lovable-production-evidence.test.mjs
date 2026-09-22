import assert from "node:assert/strict";
import test from "node:test";
import { collectZeroLovableProductionEvidence } from "../../scripts/release/zero-lovable-production.mjs";

const sha = "a".repeat(40);

function response(body, init = {}) {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    typeof body === "string" &&
    body.trimStart().startsWith("<")
  ) {
    headers.set("content-type", "text/html");
  }
  return new Response(body, { status: 200, ...init, headers });
}

function javascriptResponse(body, init = {}) {
  return response(body, {
    ...init,
    headers: { ...(init.headers ?? {}), "content-type": "application/javascript" },
  });
}

function responseAt(url, body, init = {}) {
  const value = response(body, init);
  Object.defineProperty(value, "url", { value: url });
  return value;
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("production evidence passes only with exact SHA, absent retired routes, and clean assets", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      }
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/")) {
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      }
      if (url.endsWith("/assets/app.js")) return javascriptResponse('import("./lazy/chunk.js")');
      if (url.endsWith("/assets/lazy/chunk.js")) {
        return javascriptResponse(`export const buildSha = "${sha}";`);
      }
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
        now: () => new Date("2026-09-20T00:00:00.000Z"),
      }),
  );
  assert.equal(evidence.pass, true);
  assert.equal(evidence.exactSha, true);
  assert.equal(evidence.observedRootSha, sha);
  assert.equal(evidence.browserBuildShaFound, true);
  assert.equal(evidence.assetScan.count, 2);
  assert.deepEqual(evidence.failures, []);
});

test("production evidence fails closed on stale SHA, live legacy route, and hidden chunk content", async () => {
  const stale = "b".repeat(40);
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha: stale }), { headers: { "x-kova-build": stale } });
      }
      if (url.endsWith("/.lovable/oauth/consent")) {
        return response("", { status: 307, headers: { location: "/oauth/consent" } });
      }
      if (url.includes("/lovable/email/")) return response("gone", { status: 410 });
      if (url.endsWith("/")) return response('<script src="/assets/app.js"></script>');
      if (url.endsWith("/assets/app.js"))
        return javascriptResponse("legacy LOVABLE runtime marker");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.equal(evidence.exactSha, false);
  assert.ok(evidence.failures.includes("version_sha_mismatch"));
  assert.ok(evidence.failures.includes("root_build_sha_mismatch"));
  assert.ok(evidence.failures.includes("browser_build_sha_not_found"));
  assert.ok(evidence.failures.includes("retired_route_not_404:GET:/.lovable/oauth/consent"));
  assert.ok(evidence.failures.some((failure) => failure.startsWith("lovable_asset_content:")));
});

test("production evidence probes every retired email route with safe capability methods", async () => {
  const requested = [];
  await withFetch(
    async (input, init = {}) => {
      const url = String(input);
      requested.push({ path: new URL(url).pathname, method: init.method ?? "GET" });
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      }
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/")) {
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      }
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  for (const path of [
    "/lovable/email/auth/preview",
    "/lovable/email/auth/webhook",
    "/lovable/email/queue/process",
    "/lovable/email/suppression",
    "/lovable/email/transactional/preview",
    "/lovable/email/transactional/send",
  ]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      assert.ok(
        requested.some((entry) => entry.path === path && entry.method === method),
        `${method} ${path}`,
      );
    }
  }
});

test("production evidence rejects a frontend that is not bound to the expected SHA", async () => {
  const stale = "b".repeat(40);
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      }
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/")) {
        return response(
          `<meta name="kova-build" content="${stale}"><script src="/assets/app.js"></script>`,
        );
      }
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${stale}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.exactSha, false);
  assert.equal(evidence.observedRootSha, stale);
  assert.equal(evidence.browserBuildShaFound, false);
  assert.ok(evidence.failures.includes("root_build_sha_mismatch"));
  assert.ok(evidence.failures.includes("browser_build_sha_not_found"));
});

test("production evidence rejects Lovable markers in the root response", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script>window.LOVABLE_BOOT=true</script><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(evidence.failures.includes("lovable_root_content"));
});

test("production evidence checks the final redirected asset path", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable") && !url.includes("/assets/"))
        return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js"))
        return responseAt(
          "https://kovagpt.example/assets/lovable-runtime.js",
          `const buildSha = "${sha}";`,
          { headers: { "content-type": "application/javascript" } },
        );
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(
    evidence.failures.includes(
      "lovable_asset_name:https://kovagpt.example/assets/lovable-runtime.js",
    ),
  );
});

test("production evidence requires JavaScript content before accepting the browser SHA", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js"))
        return response(`<meta name="kova-build" content="${sha}">`, {
          headers: { "content-type": "text/html" },
        });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.browserBuildShaFound, false);
  assert.ok(
    evidence.failures.includes("asset_content_type_mismatch:https://kovagpt.example/assets/app.js"),
  );
  assert.ok(evidence.failures.includes("browser_build_sha_not_found"));
});

test("production evidence redacts signed asset query credentials", async () => {
  const secret = "super-secret-token";
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js?token=${secret}"></script>`,
        );
      if (url.includes("/assets/app.js?token="))
        return responseAt(url, `const buildSha = "${sha}";`, {
          headers: { "content-type": "application/javascript" },
        });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.pass, true);
  assert.equal(serialized.includes(secret), false);
  assert.equal(evidence.assetScan.assets[0].url.includes("redacted"), true);
});

test("production evidence fails closed when safe probes advertise unsafe retired methods", async () => {
  const evidence = await withFetch(
    async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("/lovable/email/auth/webhook") && init.method === "OPTIONS")
        return response("", {
          status: 404,
          headers: { allow: "GET, HEAD, OPTIONS, POST" },
        });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(
    evidence.failures.includes(
      "retired_route_unsafe_method_advertised:/lovable/email/auth/webhook",
    ),
  );
});

test("production evidence bounds individual and aggregate response bytes", async () => {
  const perResponse = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse("x".repeat(300));
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
        maxResponseBytes: 200,
        maxTotalBytes: 10_000,
      }),
  );
  assert.ok(
    perResponse.failures.some((failure) =>
      failure.startsWith("response_body_limit_exceeded:https://kovagpt.example/assets/app.js"),
    ),
  );

  const aggregate = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
        maxResponseBytes: 128,
        maxTotalBytes: 256,
      }),
  );
  assert.ok(
    aggregate.failures.some((failure) => failure.startsWith("aggregate_body_limit_exceeded:")),
  );
});

test("production evidence rejects a redirected production root", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable") && !url.endsWith("/"))
        return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return responseAt(
          "https://lovable.example/",
          `<meta name="kova-build" content="${sha}"><script src="/runtime.js"></script>`,
        );
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.pass, false);
  assert.ok(evidence.failures.includes("root_redirected"));
});

test("production evidence discovers root-relative JavaScript outside assets", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script><script src="/legacy.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha = "${sha}";`);
      if (url.endsWith("/legacy.js")) return javascriptResponse("window.LOVABLE_RUNTIME = true;");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.pass, false);
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/legacy.js"));
});

test("production evidence scans Worker, SharedWorker, and service-worker runtime references", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js"))
        return javascriptResponse(
          `const buildSha="${sha}";new Worker(new URL("/assets/document-extraction.worker.js",import.meta.url));new SharedWorker("/assets/shared.worker.js");navigator.serviceWorker.register("/kova-sw.js");`,
        );
      if (url.endsWith("/assets/document-extraction.worker.js"))
        return javascriptResponse("window.LOVABLE_WORKER=true");
      if (url.endsWith("/assets/shared.worker.js"))
        return javascriptResponse("self.LOVABLE_SHARED=true");
      if (url.endsWith("/kova-sw.js")) return javascriptResponse("self.LOVABLE_SW=true");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.pass, false);
  assert.ok(requested.some((url) => url.endsWith("/assets/document-extraction.worker.js")));
  assert.ok(requested.some((url) => url.endsWith("/assets/shared.worker.js")));
  assert.ok(requested.some((url) => url.endsWith("/kova-sw.js")));
  assert.ok(
    evidence.failures.includes(
      "lovable_asset_content:https://kovagpt.example/assets/document-extraction.worker.js",
    ),
  );
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/kova-sw.js"));
});

test("production evidence rejects redirects from the version endpoint", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response("", {
          status: 302,
          headers: { location: "https://lovable.example/api/version" },
        });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha="${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.pass, false);
  assert.ok(evidence.failures.includes("version_redirected"));
});

test("production evidence scans retired-route 404 response bodies for Lovable markers", async () => {
  const evidence = await withFetch(
    async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.endsWith("/lovable/email/auth/webhook") && (init.method ?? "GET") === "GET")
        return response("LOVABLE branded not-found page", { status: 404 });
      if (url.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/assets/app.js"></script>`,
        );
      if (url.endsWith("/assets/app.js")) return javascriptResponse(`const buildSha="${sha}";`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );

  assert.equal(evidence.pass, false);
  assert.ok(
    evidence.failures.includes("lovable_retired_route_content:GET:/lovable/email/auth/webhook"),
  );
});

test("production evidence rejects mutable or non-HTTPS targets", async () => {
  await assert.rejects(
    collectZeroLovableProductionEvidence({ baseUrl: "http://kovagpt.example", expectedSha: sha }),
    /production_base_must_use_https/u,
  );
  await assert.rejects(
    collectZeroLovableProductionEvidence({
      baseUrl: "https://kovagpt.example",
      expectedSha: "main",
    }),
    /expected_sha_required/u,
  );
});

test("production evidence traverses worker-loaded and cached resources", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(`<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`);
      if (url.endsWith("/app.js"))
        return javascriptResponse(
          `const buildSha="${sha}";navigator.serviceWorker.register("/sw.js")`,
        );
      if (url.endsWith("/sw.js"))
        return javascriptResponse(
          `importScripts("/worker-runtime.js");cache.add("/offline.html");cache.addAll(["/one.js", "/two.js"]);`,
        );
      if (url.endsWith("/worker-runtime.js")) return javascriptResponse("self.LOVABLE=true");
      if (url.endsWith("/one.js") || url.endsWith("/two.js")) return javascriptResponse("clean");
      if (url.endsWith("/offline.html")) return response("clean offline page");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  for (const path of ["/worker-runtime.js", "/offline.html", "/one.js", "/two.js"])
    assert.ok(
      requested.some((url) => url.endsWith(path)),
      path,
    );
  assert.ok(
    evidence.failures.includes("lovable_asset_content:https://kovagpt.example/worker-runtime.js"),
  );
});

test("production evidence scans manifests, icons, and HTTP Link resource hints", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.svg">`,
          { headers: { link: '</hinted.js>; rel="preload"; as="script"' } },
        );
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      if (url.endsWith("/hinted.js")) return javascriptResponse("window.LOVABLE_HINT=true");
      if (url.endsWith("/manifest.webmanifest"))
        return response(JSON.stringify({ name: "Kova", icons: [{ src: "/manifest-icon.svg" }] }), {
          headers: { "content-type": "application/manifest+json" },
        });
      if (url.endsWith("/favicon.svg") || url.endsWith("/manifest-icon.svg"))
        return response("<svg></svg>", { headers: { "content-type": "image/svg+xml" } });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  for (const path of ["/manifest.webmanifest", "/favicon.svg", "/manifest-icon.svg", "/hinted.js"])
    assert.ok(
      requested.some((url) => url.endsWith(path)),
      path,
    );
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/hinted.js"));
});

test("production evidence ignores build metadata inside HTML comments", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<!-- <meta name="kova-build" content="${sha}"> --><script src="/app.js"></script>`,
        );
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.observedRootSha, null);
  assert.ok(evidence.failures.includes("root_build_sha_mismatch"));
});

test("production evidence scans the version response body for Lovable markers", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha, provider: "Lovable" }), {
          headers: { "x-kova-build": sha },
        });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(`<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`);
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.ok(evidence.failures.includes("lovable_version_content"));
});

test("production evidence rejects Lovable FQDN targets with trailing dots", async () => {
  for (const baseUrl of ["https://lovable.app./", "https://tenant.lovable.dev./"])
    await assert.rejects(
      collectZeroLovableProductionEvidence({ baseUrl, expectedSha: sha }),
      /production_base_must_not_use_lovable/u,
    );
});

test("production evidence traverses CSS url() resources", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script><link rel="stylesheet" href="/style.css">`,
        );
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      if (url.endsWith("/style.css"))
        return response('body{background:url("/images/brand.svg")}', {
          headers: { "content-type": "text/css" },
        });
      if (url.endsWith("/images/brand.svg"))
        return response("<svg><text>Lovable</text></svg>", {
          headers: { "content-type": "image/svg+xml" },
        });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(requested.some((url) => url.endsWith("/images/brand.svg")));
  assert.ok(
    evidence.failures.includes("lovable_asset_content:https://kovagpt.example/images/brand.svg"),
  );
});

test("production evidence fails closed on invalid UTF-8 textual assets", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script><link rel="icon" href="/bad.svg">`,
        );
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      if (url.endsWith("/bad.svg"))
        return new Response(new Uint8Array([0xff, 0xfe, 0x4c, 0x00, 0x6f, 0x00]), {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(evidence.failures.includes("asset_invalid_utf8:https://kovagpt.example/bad.svg"));
});

test("production evidence honors the first valid HTML base URL", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><base href="/sub/"><script src="app.js"></script>`,
        );
      if (url.endsWith("/sub/app.js"))
        return javascriptResponse(`const buildSha="${sha}";window.Lovable=true`);
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.ok(requested.some((url) => url.endsWith("/sub/app.js")));
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/sub/app.js"));
});

test("production evidence traverses HTML media and rejects data URL assets", async () => {
  const requested = [];
  const evidence = await withFetch(
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script><script src="data:text/javascript,globalThis.%4c%6f%76%61%62%6c%65=true"></script><img src="/logo.svg">`,
        );
      if (url.endsWith("/app.js")) return javascriptResponse(`const buildSha="${sha}"`);
      if (url.endsWith("/logo.svg"))
        return response("<svg><text>Lovable</text></svg>", {
          headers: { "content-type": "image/svg+xml" },
        });
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.ok(requested.some((url) => url.endsWith("/logo.svg")));
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/logo.svg"));
  assert.ok(evidence.failures.includes("data_url_asset_rejected:data:text/javascript,"));
});

test("production evidence preserves root cookies for same-origin assets", async () => {
  const evidence = await withFetch(
    async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/api/version"))
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (new URL(url).pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.endsWith("/"))
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`,
          { headers: { "set-cookie": "variant=browser; Path=/; Secure; HttpOnly" } },
        );
      if (url.endsWith("/app.js")) {
        const cookie = new Headers(init.headers).get("cookie");
        return javascriptResponse(
          cookie === "variant=browser"
            ? `const buildSha="${sha}";window.Lovable=true`
            : `const buildSha="${sha}"`,
        );
      }
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.ok(evidence.failures.includes("lovable_asset_content:https://kovagpt.example/app.js"));
});

test("production evidence bounds total wall-clock runtime", async () => {
  const evidence = await withFetch(
    async (_input, init = {}) =>
      new Promise((resolve) => {
        init.signal.addEventListener("abort", () => resolve(response("", { status: 408 })), {
          once: true,
        });
      }),
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
        maxDurationMs: 5,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(
    evidence.failures.some((failure) => failure.startsWith("collection_deadline_exceeded")),
  );
});

test("production evidence updates cookies set by recursive asset responses", async () => {
  const calls = [];
  const evidence = await withFetch(
    async (input, options) => {
      const url = new URL(input);
      const cookie = new Headers(options.headers).get("cookie") ?? "";
      calls.push([url.pathname, cookie]);
      if (url.pathname === "/api/version")
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.pathname === "/")
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`,
          { headers: { "set-cookie": "variant=old; Path=/; Secure" } },
        );
      if (url.pathname === "/app.js")
        return javascriptResponse(`export const buildSha="${sha}"; import("/nested/chunk.js");`, {
          headers: { "set-cookie": "variant=new; Path=/; Secure" },
        });
      if (url.pathname === "/nested/chunk.js")
        return javascriptResponse(
          cookie === "variant=new" ? "globalThis.Lovable=true" : "export const clean=true;",
        );
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.deepEqual(
    calls.find(([path]) => path === "/app.js"),
    ["/app.js", "variant=old"],
  );
  assert.deepEqual(
    calls.find(([path]) => path === "/nested/chunk.js"),
    ["/nested/chunk.js", "variant=new"],
  );
  assert.ok(evidence.failures.some((failure) => failure.startsWith("lovable_asset_content:")));
});

test("production evidence removes expired cookies and scopes asset cookies by path", async () => {
  const calls = [];
  const evidence = await withFetch(
    async (input, options) => {
      const url = new URL(input);
      const cookie = new Headers(options.headers).get("cookie") ?? "";
      calls.push([url.pathname, cookie]);
      if (url.pathname === "/api/version")
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.pathname === "/")
        return response(
          `<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`,
          { headers: { "set-cookie": "variant=old; Path=/; Secure" } },
        );
      if (url.pathname === "/app.js") {
        const result = javascriptResponse(
          `const buildSha="${sha}"; import("/nested/chunk.js"); import("/outside.js");`,
        );
        result.headers.append("set-cookie", "variant=gone; Max-Age=0; Path=/; Secure");
        result.headers.append("set-cookie", "scoped=active; Path=/nested; Secure");
        result.headers.append("set-cookie", "foreign=ignored; Domain=elsewhere.example; Path=/");
        return result;
      }
      if (["/nested/chunk.js", "/outside.js"].includes(url.pathname))
        return javascriptResponse("export {};");
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, true);
  assert.deepEqual(
    calls.find(([path]) => path === "/nested/chunk.js"),
    ["/nested/chunk.js", "scoped=active"],
  );
  assert.deepEqual(
    calls.find(([path]) => path === "/outside.js"),
    ["/outside.js", ""],
  );
});

test("production evidence returns failed JSON when an asset body is aborted", async () => {
  const evidence = await withFetch(
    async (input) => {
      const url = new URL(input);
      if (url.pathname === "/api/version")
        return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
      if (url.pathname.includes("lovable")) return response("missing", { status: 404 });
      if (url.pathname === "/")
        return response(`<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`);
      if (url.pathname === "/app.js")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("body timed out", "AbortError"));
            },
          }),
          { headers: { "content-type": "application/javascript" } },
        );
      throw new Error(`unexpected URL ${url}`);
    },
    () =>
      collectZeroLovableProductionEvidence({
        baseUrl: "https://kovagpt.example",
        expectedSha: sha,
      }),
  );
  assert.equal(evidence.pass, false);
  assert.ok(
    evidence.failures.some((failure) => failure.startsWith("collection_deadline_exceeded:")),
  );
  assert.doesNotThrow(() => JSON.stringify(evidence));
});

test("production evidence rejects data URLs in every worker dependency form", async () => {
  for (const dependency of [
    'importScripts("data:text/javascript,globalThis.%4c%6f%76%61%62%6c%65=true")',
    'cache.add("data:text/javascript,globalThis.%4c%6f%76%61%62%6c%65=true")',
    'cache.addAll(["data:text/javascript,globalThis.%4c%6f%76%61%62%6c%65=true"])',
  ]) {
    const evidence = await withFetch(
      async (input) => {
        const url = new URL(input);
        if (url.pathname === "/api/version")
          return response(JSON.stringify({ sha }), { headers: { "x-kova-build": sha } });
        if (url.pathname.includes("lovable")) return response("missing", { status: 404 });
        if (url.pathname === "/")
          return response(
            `<meta name="kova-build" content="${sha}"><script src="/app.js"></script>`,
          );
        if (url.pathname === "/app.js")
          return javascriptResponse(
            `const buildSha="${sha}"; navigator.serviceWorker.register("/worker.js");`,
          );
        if (url.pathname === "/worker.js") return javascriptResponse(dependency);
        throw new Error(`unexpected URL ${url}`);
      },
      () =>
        collectZeroLovableProductionEvidence({
          baseUrl: "https://kovagpt.example",
          expectedSha: sha,
        }),
    );
    assert.equal(evidence.pass, false, dependency);
    assert.ok(
      evidence.failures.some((failure) => failure.startsWith("data_url_asset_rejected:")),
      dependency,
    );
    assert.equal(JSON.stringify(evidence).includes("%4c%6f%76"), false);
  }
});
