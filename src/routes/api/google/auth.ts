// Start Google OAuth flow. Requires a signed-in KovaGPT user.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { buildGoogleAuthUrl } from "@/lib/google-oauth.server";

export const Route = createFileRoute("/api/google/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
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
        const sig = await crypto.subtle.sign(
          "HMAC",
          key,
          new TextEncoder().encode(payload),
        );
        const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const state = `${payload}.${sigB64}`;
        const url = buildGoogleAuthUrl({ request, state });
        return Response.json({ url });
      },
    },
  },
});
