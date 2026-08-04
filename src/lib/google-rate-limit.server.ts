const buckets = new Map<string, { count: number; resetAt: number }>();

export function enforceGoogleRateLimit(
  userId: string,
  operation: string,
  limit = 60,
): Response | null {
  const now = Date.now();
  const key = `${userId}:${operation}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (current.count >= limit) {
    return Response.json(
      { error: "rate_limited", message: "Too many Google requests. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)) },
      },
    );
  }
  current.count += 1;
  return null;
}
