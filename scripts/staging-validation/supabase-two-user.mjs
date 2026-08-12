#!/usr/bin/env node
import { args, jsonFile, print, result } from "./lib.mjs";

const cli = args();
if (cli.help || !cli.manifest) {
  console.log(
    "Usage: SUPABASE_URL=https://<staging>.supabase.co STAGING_USER_A_TOKEN=... STAGING_USER_B_TOKEN=... node scripts/staging-validation/supabase-two-user.mjs --manifest resources.json --execute",
  );
  process.exit(cli.help ? 0 : 2);
}
const endpoint = process.env.SUPABASE_URL || "";
const tokenA = process.env.STAGING_USER_A_TOKEN || "";
const tokenB = process.env.STAGING_USER_B_TOKEN || "";
const decode = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
};
let host = "";
try {
  host = new URL(endpoint).hostname;
} catch {
  /* invalid input is reported below */
}
const checks = [
  { status: cli.execute ? "PASS" : "BLOCKER", code: "explicit_execute_required" },
  {
    status: host.endsWith(".supabase.co") && !cli["production-project"] ? "PASS" : "BLOCKER",
    code: "staging_destination_guard",
  },
  {
    status: tokenA && tokenB && tokenA !== tokenB ? "PASS" : "BLOCKER",
    code: "distinct_user_sessions",
  },
  {
    status:
      decode(tokenA).role === "authenticated" && decode(tokenB).role === "authenticated"
        ? "PASS"
        : "BLOCKER",
    code: "no_service_role",
  },
];
const resources = jsonFile(cli.manifest).resources || [];
if (!resources.length) checks.push({ status: "BLOCKER", code: "fixture_manifest_required" });
if (!checks.some((check) => check.status === "BLOCKER")) {
  const headers = (token) => ({
    Authorization: `Bearer ${token}`,
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  });
  for (const resource of resources) {
    const idColumn = resource.idColumn || "id";
    const url = `${endpoint}/rest/v1/${encodeURIComponent(resource.table)}?${encodeURIComponent(idColumn)}=eq.${encodeURIComponent(resource.id)}&select=${encodeURIComponent(idColumn)}`;
    const ownerRead = await fetch(url, { headers: headers(tokenA) });
    const ownerRows = ownerRead.ok ? await ownerRead.json() : [];
    checks.push({
      status: ownerRead.ok && ownerRows.length === 1 ? "PASS" : "BLOCKER",
      code: "owner_can_read",
      resource: resource.table,
    });
    for (const [operation, method, body] of [
      ["read", "GET"],
      ["update", "PATCH", { [resource.ownerColumn || "owner_id"]: decode(tokenB).sub }],
      ["delete", "DELETE"],
    ]) {
      const response = await fetch(url, {
        method,
        headers: headers(tokenB),
        body: body ? JSON.stringify(body) : undefined,
      });
      const rows = response.ok ? await response.json() : [];
      checks.push({
        status: !response.ok || rows.length === 0 ? "PASS" : "BLOCKER",
        code: `cross_user_${operation}_denied`,
        resource: resource.table,
        httpStatus: response.status,
      });
    }
  }
}
print(
  result("supabase-two-user", checks, {
    executed: cli.execute === true,
    resourceCount: resources.length,
    secretValuesPrinted: false,
  }),
);
