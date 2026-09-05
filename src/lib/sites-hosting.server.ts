import { siteHostingConfig, type SiteHosting } from "./sites-policy.mjs";
let cached: { origin: string; until: number; ready: boolean } | undefined;
/** A configured URL alone is not publication evidence: the dedicated server
 * must report its own health contract before preview or publication is offered. */
export async function readySiteHosting(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
): Promise<SiteHosting | null> {
  const config = siteHostingConfig(env);
  if (!config) return null;
  if (cached?.origin === config.assetOrigin && cached.until > Date.now())
    return cached.ready ? config : null;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 3000);
  let ready = false;
  try {
    const response = await fetcher(config.assetOrigin + "/health", {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let content = "";
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (content.length + next.value.length > 1024) {
          await reader.cancel();
          return null;
        }
        content += decoder.decode(next.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    const value = JSON.parse(content);
    ready = value?.ok === true && value?.service === "kova-sites-assets";
    return ready ? config : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    cached = { origin: config.assetOrigin, until: Date.now() + 30000, ready };
  }
}
