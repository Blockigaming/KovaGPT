const port = Number(process.env.EMAIL_WORKER_PORT || 8789);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) process.exit(1);

try {
  const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
    signal: AbortSignal.timeout(4_000),
  });
  const body = await response.json();
  if (
    response.status !== 200 ||
    body?.status !== "ok" ||
    body?.service !== "kovagpt-email-worker" ||
    body?.execution_enabled !== true ||
    body?.agent_execution_enabled !== false
  ) {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
