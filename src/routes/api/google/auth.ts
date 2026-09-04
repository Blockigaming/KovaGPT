// Start Google OAuth flow. Requires a signed-in KovaGPT user.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { buildGoogleAuthUrl } from "@/lib/google-oauth.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

export const Route = createFileRoute("/api/google/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "connector_write",
        );
        if (lockdown) return lockdown;
        const limited = await enforceGoogleRateLimit(auth.userId, "oauth", 10);
        if (limited) return limited;
        if (
          !process.env.GOOGLE_OAUTH_CLIENT_ID ||
          !process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
          !process.env.GOOGLE_REDIRECT_URI
        ) {
          return Response.json({ error: "Google OAuth is not configured" }, { status: 503 });
        }
        // State encodes the user id so the callback (which is not
        // authenticated by the bearer flow) can identify who to store
        // tokens for. Signed with SUPABASE_SERVICE_ROLE_KEY as an HMAC
        // secret to prevent forgery.
        const nonce = crypto.randomUUID();
        const payload = `${auth.userId}.${nonce}.${Date.now()}`;
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY!),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
        const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const state = `${payload}.${sigB64}`;
        try {
          const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
          const codeVerifier = btoa(String.fromCharCode(...verifierBytes))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const challengeBytes = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(codeVerifier),
          );
          const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const url = buildGoogleAuthUrl({ request, state, codeChallenge });
          return Response.json(
            { url },
            {
              headers: {
                "Set-Cookie": `__Host-kova_google_oauth=${state}.${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
              },
            },
          );
        } catch {
          return Response.json({ error: "Google OAuth configuration is invalid" }, { status: 503 });
        }
      },
    },
  },
});
