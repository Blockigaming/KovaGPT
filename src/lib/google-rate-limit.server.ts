import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

export async function enforceGoogleRateLimit(
  userId: string,
  operation: string,
  limit = 60,
): Promise<Response | null> {
  const result = await consumeApplicationRateLimit({
    identity: `user:${userId}`,
    action: `google_${operation}`,
    limit,
    windowSeconds: 60,
  });
  if (!result.allowed) {
    return Response.json(
      {
        error: result.status === "limited" ? "rate_limited" : "request_protection_unavailable",
        message:
          result.status === "limited"
            ? "Too many Google requests. Try again shortly."
            : "Google request protection is temporarily unavailable.",
      },
      {
        status: result.status === "limited" ? 429 : 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(result.retryAfter),
        },
      },
    );
  }
  return null;
}
