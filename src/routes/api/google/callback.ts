// Google OAuth callback. Verifies HMAC-signed state, exchanges code,
// stores per-user tokens, then bounces back into the app.
import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForTokens, storeGoogleTokens, logAudit } from "@/lib/google-oauth.server";

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, ts, sig] = parts;
  const payload = `${userId}.${nonce}.${ts}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  if (!ok) return null;
  // 10-minute state validity.
  if (Date.now() - parseInt(ts, 10) > 10 * 60 * 1000) return null;
  return userId;
}

function bounce(request: Request, params: Record<string, string>): Response {
  const url = new URL(request.url);
  const target = new URL("/apps", url.origin);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), 302);
}

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const err = url.searchParams.get("error");
        if (err) return bounce(request, { google_error: err });
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return bounce(request, { google_error: "missing_code" });
        const userId = await verifyState(state);
        if (!userId) return bounce(request, { google_error: "invalid_state" });
        try {
          const tokens = await exchangeCodeForTokens(code, request);
          await storeGoogleTokens(userId, tokens);
          await logAudit({
            userId,
            provider: "google",
            action: "connect",
            summary: "Connected Google account",
          });
          return bounce(request, { google_connected: "1" });
        } catch (e) {
          console.error("[google callback]", e);
          return bounce(request, { google_error: "exchange_failed" });
        }
      },
    },
  },
});
