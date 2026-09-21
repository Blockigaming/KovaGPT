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
