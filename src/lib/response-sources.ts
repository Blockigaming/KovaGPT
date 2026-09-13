export type ResponseSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
};

const responseSourceText = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/\p{Cc}/gu, " ")
        .trim()
        .slice(0, max)
    : "";

export function normalizeResponseSources(value: unknown): ResponseSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const sources: ResponseSource[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    if (typeof item.url !== "string" || item.url.length > 2_048) continue;
    const rawUrl = responseSourceText(item.url, 2_048);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) continue;
    url.username = "";
    url.password = "";
    url.hash = "";
    const normalizedUrl = url.toString();
    // URL serialization can expand Unicode and escaped path bytes. Keep the
    // canonical value inside the same durable limit as the untrusted input.
    if (normalizedUrl.length > 2_048) continue;
    const key = normalizedUrl.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const title = responseSourceText(item.title, 180) || url.hostname.replace(/^www\./, "");
    const domain = url.hostname.replace(/^www\./, "").slice(0, 120);
    const snippet = responseSourceText(item.snippet, 500);
    const publishedAt = responseSourceText(item.publishedAt, 80);
    sources.push({
      id: responseSourceText(item.id, 80) || `src-${sources.length + 1}`,
      title,
      url: normalizedUrl,
      domain,
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
    if (sources.length >= 12) break;
  }
  return sources.length ? sources : undefined;
}
