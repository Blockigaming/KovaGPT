const textEncoder = new TextEncoder();

/** Constant-time UTF-8 comparison for webhook/API credentials. */
export function timingSafeEqualText(left: string, right: string): boolean {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

/** Blocks cross-site browser POSTs while allowing non-browser provider webhooks. */
export function hasTrustedBrowserOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  // Browsers set this header from the public-facing URL. In production a
  // reverse proxy may expose a different internal request URL, so an explicit
  // same-origin signal is stronger and more reliable than comparing Origin to
  // that rewritten URL.
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function rejectCrossSiteRequest(request: Request): Response | null {
  if (hasTrustedBrowserOrigin(request)) return null;
  return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
}
