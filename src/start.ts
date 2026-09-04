import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

import { renderErrorPage } from "./lib/error-page";
import { rejectCrossSiteRequest } from "./lib/http-security.server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Location is an explicit, user-triggered feature in Settings and Summary.
  // Voice and dictation are intentionally absent, so microphone access is denied.
  "Permissions-Policy": "camera=(self), geolocation=(self), microphone=(), payment=(self)",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://www.openstreetmap.org",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
};

function applySecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const rejected = rejectCrossSiteRequest(request);
      if (rejected) return applySecurityHeaders(rejected);
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024 * 1024) {
      return applySecurityHeaders(Response.json({ error: "Request too large" }, { status: 413 }));
    }
    const result = await next();
    const contextResult = result as { response?: Response };
    const maybeResponse = contextResult.response;
    if (maybeResponse instanceof Response) {
      contextResult.response = applySecurityHeaders(maybeResponse);
    }
    return result;
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("[start] request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return applySecurityHeaders(
      new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
