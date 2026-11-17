import { pathToFileURL } from "node:url";
import { readResponseBytesBounded } from "../src/lib/endpoint-reliability.mjs";

const sessionsUrl = "https://api.browserbase.com/v1/sessions";
const sessionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function probeBrowserbaseSession(apiKey, fetchImpl = fetch) {
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{1,512}$/.test(apiKey))
    throw new Error("browserbase_probe_key_missing");

  async function request(url, body, operation) {
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("http_error");
      }
      const bytes = await readResponseBytesBounded(response, 16_384, { signal });
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(`browserbase_probe_${operation}_failed`);
    }
  }

  const start = performance.now();
  const created = await request(
    sessionsUrl,
    {
      timeout: 60,
      browserSettings: { recordSession: false, logSession: false, solveCaptchas: false },
    },
    "create",
  );
  const createResponseMs = Math.round(performance.now() - start);
  if (typeof created?.id !== "string" || !sessionIdPattern.test(created.id))
    throw new Error("browserbase_probe_invalid_session");
  const sessionUrl = `${sessionsUrl}/${created.id}`;
  let liveViewResponseMs;
  try {
    const live = await request(`${sessionUrl}/debug`, undefined, "live_view");
    if (
      typeof live?.debuggerFullscreenUrl !== "string" ||
      !live.debuggerFullscreenUrl.startsWith("https://")
    )
      throw new Error("browserbase_probe_live_view_unavailable");
    liveViewResponseMs = Math.round(performance.now() - start);
  } finally {
    const released = await request(sessionUrl, { status: "REQUEST_RELEASE" }, "release");
    if (released?.id !== created.id) throw new Error("browserbase_probe_release_unconfirmed");
  }
  return { createResponseMs, liveViewResponseMs, releaseAcknowledged: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { createResponseMs, liveViewResponseMs, releaseAcknowledged } =
      await probeBrowserbaseSession(process.env.BROWSERBASE_API_KEY);
    console.log(JSON.stringify({ createResponseMs, liveViewResponseMs, releaseAcknowledged }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "browserbase_probe_failed");
    process.exitCode = 1;
  }
}
