import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import {
  clearOAuthResponseFromUrl,
  completeOAuthSessionFromUrl,
  getCallbackPostAuthRedirect,
  getSafePostAuthRedirect,
} from "@/lib/oauth-session";

export const Route = createFileRoute("/~oauth/callback")({
  component: OAuthCallbackPage,
  head: () => ({
    meta: [{ title: "KovaGPT Login" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function OAuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError("Sign in timed out. Check your connection and try again.");
    }, 20_000);

    async function finishSignIn() {
      try {
        const callbackRedirect = getCallbackPostAuthRedirect();
        const session = await completeOAuthSessionFromUrl("callback route");
        if (cancelled) return;

        if (!session?.user) {
          throw new Error("No saved session was found after sign in.");
        }

        clearOAuthResponseFromUrl();
        const next = getSafePostAuthRedirect(callbackRedirect);
        window.location.replace(next);
      } catch (err) {
        if (cancelled) return;
        console.error("[KovaAuth] Authentication callback could not create a session", {
          error: err instanceof Error ? err.name : "unknown_error",
        });
        setError("Sign in could not be completed. Please try again.");
      }
    }

    finishSignIn();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div className="flex max-w-sm flex-col items-center text-center">
        <NovaLogo className="h-12 w-12" />
        {error ? (
          <>
            <h1 className="mt-5 text-lg font-semibold">Sign in could not finish</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">Support reference: AUTH-CALLBACK</p>
            <a
              href="/?sign-in=1"
              className="mt-5 inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Try again
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mt-5 h-5 w-5 animate-spin text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">Signing you in</h1>
          </>
        )}
      </div>
    </main>
  );
}
