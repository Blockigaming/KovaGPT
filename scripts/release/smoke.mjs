const dry = process.argv.includes("--dry-run");
const base = process.env.KOVA_SMOKE_BASE_URL;
const enabled = process.env.KOVA_STAGING_SMOKE === "1";
if (dry || !enabled) {
  console.log(
    "SAFE DRY RUN: no network, paid provider, email, billing, agent, or scheduled-task action executed.",
  );
  process.exit(0);
}
if (!base) throw new Error("KOVA_SMOKE_BASE_URL is required");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);
try {
  for (const path of ["/api/livez", "/api/readyz", "/"]) {
    const r = await fetch(new URL(path, base), {
      signal: controller.signal,
      headers: { "x-correlation-id": crypto.randomUUID() },
    });
    if (!r.ok) throw new Error(`Smoke check failed: ${path} (${r.status})`);
  }
  console.log("Non-destructive staging smoke passed.");
} finally {
  clearTimeout(timer);
}
