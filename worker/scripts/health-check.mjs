const endpoint = process.env.WORKER_HEALTH_URL || "http://127.0.0.1:8788/readyz";
const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}
console.log(await response.text());
