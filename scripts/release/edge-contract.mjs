import { mkdir, readFile, writeFile } from "node:fs/promises";
const source = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
for (const required of [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-Frame-Options",
  "rejectCrossSiteRequest",
  "16 * 1024 * 1024",
])
  if (!source.includes(required)) throw new Error(`Missing edge contract: ${required}`);
const target = process.env.KOVA_EDGE_BASE_URL;
if (!target) {
  console.log("Local source edge contract passed; remote probe disabled.");
  process.exit(0);
}
const url = new URL(target);
const allowed = (process.env.KOVA_EDGE_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim());
if (url.protocol !== "https:" || !allowed.includes(url.hostname))
  throw new Error("Edge target is not explicitly allowed");
const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
if (response.status >= 500) throw new Error(`Deployed edge returned ${response.status}`);
for (const h of [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
])
  if (!response.headers.has(h)) throw new Error(`Deployed edge missing ${h}`);
if (response.headers.get("server")?.toLowerCase().includes("express"))
  throw new Error("Server identity leaked");
const live = await fetch(new URL("/api/livez", url), { signal: AbortSignal.timeout(5000) });
const ready = await fetch(new URL("/api/readyz", url), { signal: AbortSignal.timeout(5000) });
const diagnostics = await fetch(new URL("/api/admin/diagnostics", url), {
  signal: AbortSignal.timeout(5000),
});
if (!live.ok || ![200, 503].includes(ready.status) || ![401, 403, 503].includes(diagnostics.status))
  throw new Error("Health or diagnostics denial contract failed");
for (const result of [live, ready, diagnostics])
  if (!result.headers.get("cache-control")?.includes("no-store"))
    throw new Error("Sensitive edge response is cacheable");
const options = await fetch(new URL("/api/readyz", url), {
  method: "OPTIONS",
  signal: AbortSignal.timeout(5000),
});
if (options.headers.get("access-control-allow-origin") === "*")
  throw new Error("Wildcard CORS detected");
const report = {
  schemaVersion: 1,
  host: url.hostname,
  checkedAt: new Date().toISOString(),
  https: true,
  status: "passed",
  checks: {
    headers: true,
    health: true,
    diagnosticsDenied: true,
    cache: true,
    cors: true,
    optionsStatus: options.status,
  },
};
await mkdir("artifacts/release", { recursive: true });
await writeFile("artifacts/release/edge-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Edge contract passed for ${url.hostname}`);
