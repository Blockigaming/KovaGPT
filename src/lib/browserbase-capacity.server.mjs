export async function readBrowserCapacity({ projectId, apiKey, fetchImpl = fetch }) {
  if (!projectId || !apiKey) throw new Error("Browserbase credentials are missing");
  const response = await fetchImpl(
    `https://api.browserbase.com/v1/projects/${encodeURIComponent(projectId)}`,
    { headers: { "X-BB-API-Key": apiKey }, signal: AbortSignal.timeout(5000), cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Browserbase project lookup failed (HTTP ${response.status})`);
  const project = await response.json();
  if (
    project.id !== projectId ||
    !Number.isSafeInteger(project.concurrency) ||
    project.concurrency < 0
  ) {
    throw new Error("Browserbase returned invalid project capacity");
  }
  return project.concurrency;
}
