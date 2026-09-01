import { renderErrorPage } from "./lib/error-page";
import { rejectCrossSiteRequest } from "./lib/http-security.server";

import { validateAzureRuntimeEnv } from "./lib/azure-runtime-env.server";
import { enforceAzureProductionOriginBoundary } from "./lib/origin-boundary.server";
import { withRuntimeBindings } from "./lib/runtime-env.server";

validateAzureRuntimeEnv();

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const CONTENT_SECURITY_POLICY = [
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
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

function hardenResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const securityHeaders: Record<string, string> = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    // Voice and browser dictation are intentionally absent from KovaGPT.
    "Permissions-Policy": "camera=(), geolocation=(self), microphone=(), payment=(self), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  };
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  if (!headers.has("Cache-Control") && response.status >= 400) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    const pending = import("@tanstack/react-start/server-entry").then(
      (module) =>
        (module as { default?: ServerEntry }).default ?? (module as unknown as ServerEntry),
    );
    serverEntryPromise = pending;
    void pending.catch(() => {
      if (serverEntryPromise === pending) serverEntryPromise = undefined;
    });
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error("[server] unhandled SSR response", { status: response.status });
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const rejectedOrigin = enforceAzureProductionOriginBoundary(request);
      if (rejectedOrigin) return hardenResponse(rejectedOrigin);

      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        const rejected = rejectCrossSiteRequest(request);
        if (rejected) return hardenResponse(rejected);
      }
      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > 16 * 1024 * 1024) {
        return hardenResponse(Response.json({ error: "Request too large" }, { status: 413 }));
      }
      const handler = await getServerEntry();
      const response = await withRuntimeBindings(env, () => handler.fetch(request, env, ctx));
      return hardenResponse(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error("[server] request failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return hardenResponse(brandedErrorResponse());
    }
  },
};
