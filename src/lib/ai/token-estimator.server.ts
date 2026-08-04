export type TokenEstimate = { tokens: number; imageCount: number };

// Conservative offline estimator calibrated above typical cl100k/o200k token
// counts. It counts UTF-8 bytes, structural JSON overhead, tool schemas and a
// fixed high-detail image allowance. Provider-reported usage is authoritative.
export function estimateProviderInput(value: unknown): TokenEstimate {
  let bytes = 0;
  let imageCount = 0;
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      bytes += new TextEncoder().encode(item).byteLength + 8;
      return;
    }
    if (typeof item === "number" || typeof item === "boolean") {
      bytes += String(item).length + 4;
      return;
    }
    if (!item) return;
    if (Array.isArray(item)) {
      bytes += 4;
      item.forEach(visit);
      return;
    }
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.type === "image_url" || record.type === "input_image") imageCount += 1;
      bytes += 8;
      for (const [key, nested] of Object.entries(record)) {
        bytes += key.length + 4;
        if (
          (key === "url" || key === "image_url") &&
          typeof nested === "string" &&
          nested.startsWith("data:image/")
        )
          continue;
        visit(nested);
      }
    }
  };
  visit(value);
  return { tokens: Math.ceil(bytes / 3) + imageCount * 1_200, imageCount };
}
