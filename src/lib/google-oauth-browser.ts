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
