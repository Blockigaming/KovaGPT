// Google OAuth callback. Verifies HMAC-signed state, exchanges code,
// stores per-user tokens, then bounces back into the app.
import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForTokens, storeGoogleTokens, logAudit } from "@/lib/google-oauth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, nonce, ts, sig] = parts;
  const payload = `${userId}.${nonce}.${ts}`;
  let ok: boolean;
  try {
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
    ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  // Ten-minute validity with a small clock-skew allowance. Reject malformed
  // and future-dated states instead of accidentally extending their lifetime.
  const issuedAt = Number(ts);
  const age = Date.now() - issuedAt;
  if (!Number.isSafeInteger(issuedAt) || age < -30_000 || age > 10 * 60 * 1000) return null;
  return userId;
}

function bounce(request: Request, params: Record<string, string>, clearState = false): Response {
  const url = new URL(request.url);
  const target = new URL("/apps", url.origin);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  const headers = new Headers({ Location: target.toString() });
  if (clearState) {
    headers.set(
      "Set-Cookie",
      "__Host-kova_google_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
  }
  return new Response(null, { status: 302, headers });
}

function readOAuthCookie(request: Request): { state: string; verifier: string } | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("__Host-kova_google_oauth="));
  const value = cookie?.slice("__Host-kova_google_oauth=".length);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  return { state: value.slice(0, separator), verifier: value.slice(separator + 1) };
}

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (
          !process.env.SUPABASE_SERVICE_ROLE_KEY ||
          !process.env.GOOGLE_OAUTH_CLIENT_ID ||
          !process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
          !process.env.GOOGLE_REDIRECT_URI
        ) {
          return bounce(request, { google_error: "not_configured" }, true);
        }
        const url = new URL(request.url);
        const err = url.searchParams.get("error");
        if (err) return bounce(request, { google_error: err }, true);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthCookie = readOAuthCookie(request);
        if (!code || !state) return bounce(request, { google_error: "missing_code" }, true);
        if (!oauthCookie || oauthCookie.state !== state) {
          return bounce(request, { google_error: "invalid_state" }, true);
        }
        const userId = await verifyState(state);
        if (!userId) return bounce(request, { google_error: "invalid_state" }, true);
        try {
          // Re-check after authenticating the callback owner. Lockdown Mode can
          // be enabled while the Google consent page is still open.
          await assertLockdownAllows(supabaseAdmin, userId, "connector_write");
          const tokens = await exchangeCodeForTokens(code, request, oauthCookie.verifier);
          await storeGoogleTokens(userId, tokens);
          await logAudit({
            userId,
            provider: "google",
            action: "connect",
            summary: "Connected Google account",
          });
          return bounce(request, { google_connected: "1" }, true);
        } catch (e) {
          console.error("[google callback]", e);
          return bounce(request, { google_error: "exchange_failed" }, true);
        }
      },
    },
  },
});
