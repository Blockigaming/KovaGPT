import { nativeKovaPlatform } from "@/lib/kova-native";
import { browserKovaAuthOrigin } from "@/lib/kova-auth-browser";
import { getOAuthRedirectUri } from "@/lib/oauth-session";

export function isOwnedGoogleConfigured(): boolean {
  return import.meta.env.VITE_KOVA_GOOGLE_AUTH_ENABLED === "true";
}

export async function startGoogleOAuth(useKovaAuth: boolean, returnTo?: string) {
  if (useKovaAuth) {
    const start = new URL("/api/auth/google/start", browserKovaAuthOrigin());
    start.searchParams.set(
      "return_to",
      returnTo ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    if (nativeKovaPlatform() === "ios") {
      const hex = (value: Uint8Array) =>
        Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      document.cookie = `__Host-kova_native_google=${verifier}; Path=/; Max-Age=600; Secure; SameSite=Lax`;
      const nativeStart = new URL(start.pathname + start.search, window.location.origin);
      nativeStart.searchParams.set("native_challenge", hex(new Uint8Array(digest)));
      window.location.assign(nativeStart.toString());
      return { redirected: false };
    }
    window.location.assign(start.toString());
    return { redirected: true };
  }

  const { providerAuth } = await import("@/integrations/provider-auth");
  const result = await providerAuth.auth.signInWithOAuth("google", {
    redirect_uri: getOAuthRedirectUri(),
  });
  if (result.error) throw result.error;
  return result;
}
