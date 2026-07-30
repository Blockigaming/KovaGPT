import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

import { renderErrorPage } from "./lib/error-page";
import { rejectCrossSiteRequest } from "./lib/http-security.server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Location is an explicit, user-triggered feature in Settings and Summary.
  // Keep it same-origin while denying unrelated camera access and cross-origin use.
  "Permissions-Policy": "camera=(), geolocation=(self), microphone=(self), payment=(self)",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.clerk.accounts.dev https://*.clerk.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.clerk.accounts.dev https://*.clerk.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://*.clerk.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
};

function applySecurityHeaders(res: Response): Response {
  // Don't mutate opaque/streaming responses unnecessarily; clone headers safely.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
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
    // `next()` returns a context object; the framework writes the final Response
    // separately. We attach headers here best-effort via the returned response
    // when present.
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
    console.error(error);
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
