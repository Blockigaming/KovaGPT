import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

import { renderErrorPage } from "./lib/error-page";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Location is an explicit, user-triggered feature in Settings and Summary.
  // Keep it same-origin while denying unrelated camera access and cross-origin use.
  "Permissions-Policy": "camera=(), geolocation=(self), microphone=(self), payment=(self)",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
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

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
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
