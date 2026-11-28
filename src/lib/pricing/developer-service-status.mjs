export const developerStatusProbes = Object.freeze([
  { id: "liveness", label: "Application liveness", path: "/api/livez" },
  { id: "readiness", label: "Platform readiness", path: "/api/readyz" },
  { id: "ingress", label: "Developer authentication gate", path: "/api/v1/models" },
]);

export function developerProbeState(id, status, body) {
  if (id === "liveness" && status === 200 && body?.status === "alive") return "ready";
  if (id === "readiness") {
    if (status === 200 && body?.status === "ready") return "ready";
    if (status === 200 && body?.status === "degraded") return "degraded";
    if (status === 503 && body?.status === "unavailable") return "unavailable";
  }
  if (id === "ingress") {
    if (status === 401 && body?.error?.code === "developer_unauthorized") return "ready";
    if (status === 503 && body?.error?.code === "developer_platform_disabled") return "unavailable";
  }
  return status >= 500 ? "unavailable" : "unknown";
}

// Fixed same-origin paths; no session cookies, API keys, provider calls, or retries.
export async function checkDeveloperStatus(fetcher, signal) {
  return Promise.all(
    developerStatusProbes.map(async (probe) => {
      try {
        const response = await fetcher(probe.path, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal,
        });
        const body = await response.json();
        return {
          id: probe.id,
          state: developerProbeState(probe.id, response.status, body),
          checkedAt: new Date().toISOString(),
        };
      } catch {
        return { id: probe.id, state: "unknown", checkedAt: new Date().toISOString() };
      }
    }),
  );
}
