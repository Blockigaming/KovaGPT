import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function requirement(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function cloudflareRequest({ zoneId, apiToken }, path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare API ${path} failed with ${response.status}`);
  }
  return body.result;
}

export function normalizeCidrs(result) {
  const cidrs = [...(result?.ipv4_cidrs ?? []), ...(result?.ipv6_cidrs ?? [])];
  assert.ok(cidrs.length >= 10, "Cloudflare IP list is unexpectedly short");
  assert.equal(new Set(cidrs).size, cidrs.length, "Cloudflare IP list contains duplicates");
  return cidrs.sort();
}

export function validateDnsRecord(record, { hostname, origin }) {
  assert.equal(record?.name, hostname, `${hostname} DNS record is missing`);
  assert.equal(record?.type, "CNAME", `${hostname} must use a proxied CNAME`);
  assert.equal(record?.proxied, true, `${hostname} must be proxied through Cloudflare`);
  assert.equal(record?.content?.replace(/\.$/u, ""), origin, `${hostname} does not target Azure`);
}

function readAzureIngress({ resourceGroup, appName }) {
  try {
    const raw = execFileSync(
      "az",
      [
        "containerapp",
        "show",
        "-g",
        resourceGroup,
        "-n",
        appName,
        "--query",
        "properties.configuration.ingress.ipSecurityRestrictions",
        "-o",
        "json",
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error("Azure CLI is required to verify origin restrictions");
    throw error;
  }
}

export async function verifyCloudflareEdgeOnly({
  env = process.env,
  args = process.argv.slice(2),
} = {}) {
  const dryRun = args.includes("--dry-run");
  const baseUrl = new URL(env.KOVA_PUBLIC_BASE_URL || "https://kovagpt.com");
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const azureOrigin = env.KOVA_AZURE_ORIGIN_FQDN?.trim()
    ?.replace(/^https?:\/\//u, "")
    .replace(/\/$/u, "");
  const resourceGroup = env.KOVA_AZURE_RESOURCE_GROUP?.trim();
  const appName = env.KOVA_AZURE_CONTAINER_APP?.trim();
  const evidencePath =
    env.KOVA_CLOUDFLARE_EVIDENCE_PATH || "artifacts/release/day16-cloudflare-edge.json";

  if (dryRun) {
    return {
      mode: "dry-run",
      mutatesCloudflare: false,
      requiredEnvironment: [
        "CLOUDFLARE_ZONE_ID",
        "CLOUDFLARE_API_TOKEN",
        "KOVA_AZURE_ORIGIN_FQDN",
        "KOVA_AZURE_RESOURCE_GROUP",
        "KOVA_AZURE_CONTAINER_APP",
      ],
      checks: [
        "zone active",
        "apex and www proxied CNAMEs target Azure",
        "Full (strict) TLS",
        "Always Use HTTPS",
        "minimum TLS 1.2 or newer",
        "public traffic carries Cloudflare evidence",
        "Azure origin permits exactly current Cloudflare CIDRs",
      ],
    };
  }

  requirement("CLOUDFLARE_ZONE_ID", zoneId);
  requirement("CLOUDFLARE_API_TOKEN", apiToken);
  requirement("KOVA_AZURE_ORIGIN_FQDN", azureOrigin);
  requirement("KOVA_AZURE_RESOURCE_GROUP", resourceGroup);
  requirement("KOVA_AZURE_CONTAINER_APP", appName);
  const cf = (path) => cloudflareRequest({ zoneId, apiToken }, path);

  const zone = await cf(`/zones/${zoneId}`);
  assert.equal(zone.status, "active", "Cloudflare zone is not active");
  assert.equal(
    zone.name,
    baseUrl.hostname.replace(/^www\./u, ""),
    "Cloudflare zone does not match KovaGPT",
  );

  const hosts = [zone.name, `www.${zone.name}`];
  const records = [];
  for (const hostname of hosts) {
    const result = await cf(
      `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    );
    assert.equal(result.length, 1, `${hostname} must have exactly one CNAME`);
    validateDnsRecord(result[0], { hostname, origin: azureOrigin });
    records.push({
      name: hostname,
      id: result[0].id,
      proxied: result[0].proxied,
      content: result[0].content,
    });
  }

  const [ssl, https, minTls, ipsResult] = await Promise.all([
    cf(`/zones/${zoneId}/settings/ssl`),
    cf(`/zones/${zoneId}/settings/always_use_https`),
    cf(`/zones/${zoneId}/settings/min_tls_version`),
    fetch("https://api.cloudflare.com/client/v4/ips", {
      signal: AbortSignal.timeout(20_000),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body?.success !== true)
        throw new Error("Cloudflare IP list request failed");
      return body.result;
    }),
  ]);
  assert.equal(ssl.value, "strict", "Cloudflare SSL mode must be Full (strict)");
  assert.equal(https.value, "on", "Always Use HTTPS must be enabled");
  assert.ok(["1.2", "1.3"].includes(minTls.value), "minimum TLS must be 1.2 or newer");
  const currentCidrs = normalizeCidrs(ipsResult);

  const publicResponse = await fetch(new URL("/api/version", baseUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(
    publicResponse.ok,
    true,
    `public version endpoint returned ${publicResponse.status}`,
  );
  assert.ok(
    publicResponse.headers.get("cf-ray"),
    "public traffic does not show Cloudflare edge evidence",
  );
  assert.ok(
    publicResponse.headers.get("x-kova-build"),
    "public response is missing Kova build identity",
  );

  const restrictions = readAzureIngress({ resourceGroup, appName });
  assert.ok(
    Array.isArray(restrictions) && restrictions.length > 0,
    "Azure origin restrictions are missing",
  );
  const allowedCidrs = restrictions
    .filter((entry) => entry.action === "Allow")
    .map((entry) => entry.ipAddressRange)
    .sort();
  assert.deepEqual(
    allowedCidrs,
    currentCidrs,
    "Azure origin allowlist must exactly match current Cloudflare CIDRs",
  );

  const evidence = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    publicOrigin: baseUrl.origin,
    azureOrigin,
    zone: { id: zone.id, name: zone.name, status: zone.status },
    dns: records,
    tls: {
      mode: ssl.value,
      alwaysUseHttps: https.value,
      minimumVersion: minTls.value,
    },
    cloudflareCidrs: currentCidrs,
    azureAllowCidrs: allowedCidrs,
    build: publicResponse.headers.get("x-kova-build"),
    cfRayPresent: true,
    cloudflareRuntimeUsed: false,
  };
  await mkdir(dirname(resolve(evidencePath)), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { ...evidence, evidencePath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await verifyCloudflareEdgeOnly();
  if (result.mode === "dry-run") console.log(JSON.stringify(result, null, 2));
  else console.log(`KOVA_CLOUDFLARE_EDGE_ONLY=PASS evidence=${result.evidencePath}`);
}
