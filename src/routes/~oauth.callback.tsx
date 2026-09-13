import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

const TRANSITION_REVEAL_DELAY_MS = 400;
const CALLBACK_TIMEOUT_MS = 20_000;

function OAuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [showTransition, setShowTransition] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const revealTransition = window.setTimeout(() => {
      if (!cancelled) setShowTransition(true);
    }, TRANSITION_REVEAL_DELAY_MS);
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setShowTransition(true);
      setError("Sign in timed out. Check your connection and try again.");
    }, CALLBACK_TIMEOUT_MS);

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
        window.clearTimeout(revealTransition);
        window.clearTimeout(timeout);
        window.location.replace(next);
      } catch (err) {
        if (cancelled) return;
        window.clearTimeout(revealTransition);
        window.clearTimeout(timeout);
        console.error("[KovaAuth] Authentication callback could not create a session", {
          error: err instanceof Error ? err.name : "unknown_error",
        });
        setShowTransition(true);
        setError("Sign in could not be completed. Please try again.");
      }
    }

    finishSignIn();
    return () => {
      cancelled = true;
      window.clearTimeout(revealTransition);
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <main
      aria-busy={!error}
      className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground"
    >
      {error ? (
        <section
          aria-labelledby="oauth-callback-error-title"
          role="alert"
          className="flex max-w-sm animate-fade-up flex-col items-center text-center"
        >
          <NovaLogo className="h-12 w-12" />
          <div className="flex flex-col items-center">
            <h1 id="oauth-callback-error-title" className="mt-5 text-lg font-semibold">
              Sign in could not finish
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">Support reference: AUTH-CALLBACK</p>
            <a
              href="/?sign-in=1"
              className="mt-5 inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Try again
            </a>
          </div>
        </section>
      ) : (
        <div
          aria-hidden={!showTransition}
          className={`transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
            showTransition ? "scale-100 opacity-100" : "scale-[0.98] opacity-0"
          }`}
        >
          <NovaLogo className="h-11 w-11" animated pulse />
        </div>
      )}
      {!error ? (
        <p className="sr-only" role="status" aria-live="polite">
          Completing sign in
        </p>
      ) : null}
    </main>
  );
}
