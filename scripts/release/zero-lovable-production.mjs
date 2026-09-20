import { writeFileSync } from "node:fs";

const SHA = /^[a-f0-9]{40}$/u;
const ASSET =
  /["'`](https?:\/\/[^"'`\s]+\/assets\/[^"'`\s]+|\/assets\/[^"'`\s]+|\.\.?\/[^"'`\s]+?\.m?js(?:\?[^"'`\s]*)?)["'`]/giu;
const BUILD_META =
  /<meta\b(?=[^>]*\bname=["']kova-build["'])(?=[^>]*\bcontent=["']([a-f0-9]{40})["'])[^>]*>/giu;
const RETIRED_ROUTES = [
  "/.lovable/oauth/consent",
  "/lovable/email/suppression",
  "/lovable/email/auth/preview",
  "/lovable/email/auth/webhook",
  "/lovable/email/queue/process",
  "/lovable/email/transactional/preview",
  "/lovable/email/transactional/send",
];

function normalizeBase(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("production_base_must_use_https");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function discoverAssets(source, parent, origin) {
  const assets = new Set();
  for (const match of source.matchAll(ASSET)) {
    const url = new URL(match[1], parent);
    url.hash = "";
    if (url.origin === origin) assets.add(url.href);
  }
  return [...assets].sort();
}

async function request(url, { redirect = "follow" } = {}) {
  const response = await fetch(url, {
    redirect,
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "KovaGPT-read-only-zero-lovable-evidence/1" },
  });
  const body = await response.text();
  return {
    response,
    body,
    record: {
      url: response.url || String(url),
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      bytes: Buffer.byteLength(body),
    },
  };
}

export async function collectZeroLovableProductionEvidence({
  baseUrl,
  expectedSha,
  maxAssets = 500,
  now = () => new Date(),
}) {
  if (!SHA.test(expectedSha ?? "")) throw new Error("expected_sha_required");
  const base = normalizeBase(baseUrl);
  const failures = [];
  const versionResult = await request(new URL("/api/version", base));
  let version = null;
  try {
    version = JSON.parse(versionResult.body);
  } catch {
    failures.push("version_response_not_json");
  }
  const headerSha = versionResult.response.headers.get("x-kova-build");
  if (versionResult.response.status !== 200) failures.push("version_status_not_200");
  if (version?.sha !== expectedSha) failures.push("version_sha_mismatch");
  if (headerSha !== expectedSha) failures.push("version_header_sha_mismatch");

  const routeRecords = [];
  for (const path of RETIRED_ROUTES) {
    const result = await request(new URL(path, base), { redirect: "manual" });
    routeRecords.push({ path, ...result.record });
    if (result.response.status !== 404) failures.push(`retired_route_not_404:${path}`);
    if (result.response.headers.get("location")) failures.push(`retired_route_redirects:${path}`);
  }

  const rootResult = await request(base);
  if (rootResult.response.status !== 200) failures.push("root_status_not_200");
  const rootBuildShas = [...rootResult.body.matchAll(BUILD_META)].map((match) => match[1]);
  const rootBuildSha = rootBuildShas.length === 1 ? rootBuildShas[0] : null;
  if (rootBuildSha !== expectedSha) failures.push("root_build_sha_mismatch");

  const pending = discoverAssets(rootResult.body, base, base.origin);
  const seen = new Set();
  const assets = [];
  const contentHits = [];
  let browserBuildShaFound = false;
  while (pending.length && seen.size < maxAssets) {
    const url = pending.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (/lovable/iu.test(new URL(url).pathname)) failures.push(`lovable_asset_name:${url}`);
    const result = await request(url);
    assets.push(result.record);
    if (result.response.status !== 200) failures.push(`asset_status_not_200:${url}`);
    if (/lovable/iu.test(result.body)) {
      contentHits.push(url);
      failures.push(`lovable_asset_content:${url}`);
    }
    if (result.body.includes(expectedSha)) browserBuildShaFound = true;
    for (const nested of discoverAssets(result.body, new URL(url), base.origin)) {
      if (!seen.has(nested) && !pending.includes(nested)) pending.push(nested);
    }
  }
  if (pending.length) failures.push(`asset_limit_exceeded:${maxAssets}`);
  if (!browserBuildShaFound) failures.push("browser_build_sha_not_found");

  const exactSha =
    version?.sha === expectedSha &&
    headerSha === expectedSha &&
    rootBuildSha === expectedSha &&
    browserBuildShaFound;

  return {
    schemaVersion: 1,
    capturedAt: now().toISOString(),
    readOnly: true,
    baseUrl: base.href,
    expectedSha,
    observedSha: version?.sha ?? null,
    observedHeaderSha: headerSha,
    observedRootSha: rootBuildSha,
    browserBuildShaFound,
    exactSha,
    routes: routeRecords,
    assetScan: { count: assets.length, assets, lovableContentHits: contentHits },
    limitations: [
      "Public HTTP evidence only; this does not inspect authenticated browser traffic.",
      "Azure, Cloudflare, Supabase, OAuth-provider, email-provider, and log inventories require separate read-only exports.",
    ],
    failures: [...new Set(failures)].sort(),
    pass: failures.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.env.KOVA_PRODUCTION_BASE_URL ?? process.argv[2];
  const expectedSha = process.env.KOVA_EXPECTED_RELEASE_SHA ?? process.argv[3];
  const output = process.env.KOVA_ZERO_LOVABLE_EVIDENCE_FILE;
  if (!baseUrl) throw new Error("production_base_url_required");
  const evidence = await collectZeroLovableProductionEvidence({ baseUrl, expectedSha });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) writeFileSync(output, serialized, { flag: "wx" });
  process.stdout.write(serialized);
  if (!evidence.pass) process.exitCode = 1;
}
