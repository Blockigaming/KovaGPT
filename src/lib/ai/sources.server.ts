export type KovaSource = {
  id: string;
  url: string;
  title: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
  retrievedAt?: string;
};

export type KovaCitation = {
  marker: string;
  sourceId: string;
  index: number;
};

// Reject unsafe protocols such as javascript: before rendering source links.
export function safeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function clean(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

export function normalizeKovaSource(
  input: Partial<KovaSource> & { url?: string },
  index: number,
  retrievedAt = new Date().toISOString(),
): KovaSource | null {
  const url = safeSourceUrl(input.url ?? "");
  if (!url) return null;
  const domain = clean(input.domain, 120) ?? sourceDomain(url);
  return {
    id: input.id?.trim() || `src-${index}`,
    url,
    title: clean(input.title, 180) ?? domain,
    domain,
    ...(clean(input.snippet, 500) ? { snippet: clean(input.snippet, 500) } : {}),
    ...(clean(input.publishedAt, 80) ? { publishedAt: clean(input.publishedAt, 80) } : {}),
    retrievedAt: input.retrievedAt ?? retrievedAt,
  };
}

export function dedupeKovaSources(
  inputs: Array<Partial<KovaSource> & { url?: string }>,
): KovaSource[] {
  const seen = new Set<string>();
  const output: KovaSource[] = [];
  for (const input of inputs) {
    const source = normalizeKovaSource(input, output.length + 1);
    if (!source) continue;
    const key = source.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    source.id = `src-${output.length + 1}`;
    output.push(source);
  }
  return output;
}

export function createCitationMap(sources: KovaSource[]): KovaCitation[] {
  return sources.map((source, index) => ({
    marker: `[${index + 1}]`,
    sourceId: source.id,
    index: index + 1,
  }));
}

export function sourcePromptBlock(sources: KovaSource[]): string {
  if (!sources.length) return "";
  return sources
    .map((source, index) =>
      `[${index + 1}] ${source.title}\n${source.url}\nDomain: ${source.domain}${source.publishedAt ? `\nPublished: ${source.publishedAt}` : ""}\n${source.snippet ?? ""}`.trim(),
    )
    .join("\n\n");
}
