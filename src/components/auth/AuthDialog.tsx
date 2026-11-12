import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resolveLegacyAuthContext, supabase } from "@/integrations/supabase/client";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import githubLogo from "@/assets/plugins/github.svg";
import { validateHostedGitHubLoginRedirect } from "@/lib/hosted-github-login-redirect.mjs";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { NovaLogo } from "@/components/NovaLogo";
import {
  getEmailAuthRedirectUri,
  getOAuthRedirectUri,
  rememberPostAuthRedirect,
} from "@/lib/oauth-session";
import { useAuthProviders } from "@/hooks/useAuthProviders";
import { GOOGLE_UNCONFIGURED_MESSAGE } from "@/lib/auth-providers";
import { cn } from "@/lib/utils";
import { browserKovaAuthEnabled, browserKovaAuthMode } from "@/lib/kova-auth-browser";

import { startGoogleOAuth } from "@/lib/google-oauth-browser";

type Mode = "sign-in" | "sign-up";
type Step = "identify" | "magic-sent";

const RESEND_COOLDOWN_SECONDS = 45;

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function AuthDialog({
  open,
  mode: initialMode,
  onOpenChange,
  returnFocusTarget,
  inline = false,
}: {
  open: boolean;
  mode: Mode;
  onOpenChange: (open: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
  /** Public landing page; shares the exact same guarded authentication actions. */
  inline?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("identify");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState<
    "email" | "google" | "hosted-google" | "github" | null
  >(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const submittingRef = useRef(false);
  const navigate = useNavigate();
  const providers = useAuthProviders(open);
  const useKovaAuth = browserKovaAuthEnabled();

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep("identify");
    setEmail("");
    setEmailTouched(false);
    setCooldown(0);
  }, [initialMode, open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      submittingRef.current = false;
      setLoading(false);
      setLoadingMethod(null);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const isSignUp = mode === "sign-up";
  const emailValid = isValidEmail(email);
  // Preserve an explicit existing-account path during adoption. This never
  // runs as a fallback after an owned sign-in fails.
  const showHostedGoogle = browserKovaAuthMode() === "dual" && !isSignUp;
  const hostedGoogleAvailable = showHostedGoogle && providers.resolved && providers.google;
  const hostedGooglePending = showHostedGoogle && !providers.resolved && !providers.error;
  // Only claim Google is available once the deployment has confirmed it.
  const googleAvailable = useKovaAuth
    ? import.meta.env.VITE_KOVA_GOOGLE_AUTH_ENABLED === "true"
    : providers.resolved && providers.google;
  const googleUnavailable = useKovaAuth
    ? !googleAvailable
    : providers.resolved && !providers.google;
  const googleCheckFailed = !useKovaAuth && Boolean(providers.error);

  const guard = (method: "email" | "google" | "hosted-google" | "github") => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setLoading(true);
    setLoadingMethod(method);
    return true;
  };
  const release = () => {
    submittingRef.current = false;
    setLoading(false);
    setLoadingMethod(null);
  };

  const handleContinueEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setEmailTouched(true);
    if (!emailValid) {
      toast.error("Please enter a valid email address.");
      return;
    }
    rememberPostAuthRedirect();
    onOpenChange(false);
    void navigate({
      to: "/auth",
      search: { email: email.trim().toLowerCase(), mode },
    });
  };

  const handleGoogle = async () => {
    if (!googleAvailable) {
      toast.error(GOOGLE_UNCONFIGURED_MESSAGE);
      return;
    }
    if (!guard("google")) return;
    let redirecting = false;
    try {
      rememberPostAuthRedirect();
      const result = await startGoogleOAuth(useKovaAuth);
      if (result.redirected) {
        redirecting = true;
        return;
      }
      onOpenChange(false);
    } catch (err) {
      console.error("[KovaAuth] Google authentication failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("Google sign in could not start. Please try again.");
    } finally {
      if (!redirecting) release();
    }
  };

  const handleHostedGoogle = async () => {
    if (!hostedGoogleAvailable) {
      toast.error("Existing Google sign-in is unavailable. Close this dialog and try again.");
      return;
    }
    if (!guard("hosted-google")) return;
    let redirecting = false;
    try {
      // The shared authority gate rejects active/rejected owned cookies and
      // unavailable probes. It never forces the client onto hosted authority.
      const context = await resolveLegacyAuthContext();
      context.assertCurrent();
      rememberPostAuthRedirect();
      const { data, error } = await context.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getOAuthRedirectUri(),
          skipBrowserRedirect: true,
        },
      });
      context.assertCurrent();
      if (error) throw error;
      if (!data?.url) throw new Error("hosted_google_redirect_missing");
      window.location.assign(data.url);
      redirecting = true;
    } catch (err) {
      console.error("[KovaAuth] Existing Google authentication failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("Google sign in could not start. Please try again.");
    } finally {
      if (!redirecting) release();
    }
  };

  const githubAvailable =
    browserKovaAuthMode() !== "kova" && providers.resolved && providers.github;
  const handleGithub = async () => {
    if (!githubAvailable) {
      toast.error("GitHub sign in is not enabled for this deployment.");
      return;
    }
    if (!guard("github")) return;
    let redirecting = false;
    try {
      const context = await resolveLegacyAuthContext();
      context.assertCurrent();
      rememberPostAuthRedirect();
      const { data, error } = await context.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: getOAuthRedirectUri(), skipBrowserRedirect: true },
      });
      context.assertCurrent();
      if (error) throw error;
      if (!data?.url) throw new Error("github_redirect_missing");
      window.location.assign(
        validateHostedGitHubLoginRedirect(data.url, SUPABASE_BROWSER_CONFIG.url),
      );
      redirecting = true;
    } catch {
      toast.error("GitHub sign in could not start. Please try again.");
    } finally {
      if (!redirecting) release();
    }
  };

  const requestMagicLink = useCallback(
    async (resend: boolean) => {
      if (!isValidEmail(email)) {
        setEmailTouched(true);
        toast.error("Enter a valid email first.");
        return;
      }
      if (cooldown > 0) return;
      if (!guard("email")) return;
      try {
        rememberPostAuthRedirect();
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { emailRedirectTo: getEmailAuthRedirectUri() },
        });
        if (error) throw error;
        setStep("magic-sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        if (resend)
          publishKovaNotice({
            id: "email_verification_required",
            title: "Another sign-in link requested",
            message: "Check your inbox if a link was issued for this address.",
          });
      } catch (err) {
        console.error("[KovaAuth] Magic-link request failed", {
          error: err instanceof Error ? err.name : "unknown_error",
        });
        toast.error("The sign-in link could not be requested. Please try again.");
      } finally {
        release();
      }
    },
    [cooldown, email],
  );

  if (inline) {
    const showOwnedGoogle = !showHostedGoogle || googleAvailable;
    return (
      <div className="public-sign-in" aria-label="Sign in to KovaGPT">
        {showOwnedGoogle && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading || !googleAvailable}
              aria-busy={loadingMethod === "google"}
              aria-describedby={!googleAvailable ? "public-google-status" : undefined}
            >
              {loadingMethod === "google" ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>
            {!googleAvailable && (
              <p id="public-google-status" className="public-provider-status" role="status">
                {!useKovaAuth && !providers.resolved && !providers.error
                  ? "Checking Google availability…"
                  : "Google sign-in is unavailable. You can continue with email."}
              </p>
            )}
          </>
        )}
        {showHostedGoogle && (hostedGoogleAvailable || hostedGooglePending) && (
          <button
            type="button"
            onClick={handleHostedGoogle}
            disabled={loading || !hostedGoogleAvailable}
            aria-busy={loadingMethod === "hosted-google"}
          >
            {loadingMethod === "hosted-google" ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <GoogleIcon />
            )}
            Log in with existing Google
          </button>
        )}
        {!showOwnedGoogle && hostedGooglePending && (
          <p className="public-provider-status" role="status">
            Checking Google availability…
          </p>
        )}
        {!showOwnedGoogle && !hostedGoogleAvailable && !hostedGooglePending && (
          <p className="public-provider-status" role="status">
            Google sign-in is unavailable. You can continue with email.
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleGithub()}
          disabled={loading || !githubAvailable}
          aria-busy={loadingMethod === "github"}
          aria-describedby={!githubAvailable ? "public-github-status" : undefined}
        >
          {loadingMethod === "github" ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <img src={githubLogo} width={18} height={18} alt="" className="public-github-logo" />
          )}
          Continue with GitHub
        </button>
        {!githubAvailable && (
          <p id="public-github-status" className="public-provider-status" role="status">
            {!providers.resolved && !providers.error && browserKovaAuthMode() !== "kova"
              ? "Checking GitHub availability…"
              : "GitHub sign-in is coming soon. You can continue with email."}
          </p>
        )}
        <div className="public-auth-divider">OR</div>
        <form onSubmit={handleContinueEmail}>
          <label htmlFor="public-sign-in-email" className="sr-only">
            Email address
          </label>
          <input
            id="public-sign-in-email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            placeholder="Enter your email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={emailTouched && !emailValid}
            aria-describedby={emailTouched && !emailValid ? "public-email-error" : undefined}
          />
          {emailTouched && !emailValid && (
            <p id="public-email-error" role="alert">
              Enter a valid email address.
            </p>
          )}
          <button className="public-primary" type="submit" disabled={loading}>
            Continue with email
          </button>
        </form>
        <p className="public-auth-legal">
          By continuing, you agree to KovaGPT’s <Link to="/terms">Terms of Service</Link> and
          acknowledge its <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <p className="public-auth-switch">
          {isSignUp ? "Already have an account?" : "New to KovaGPT?"}{" "}
          <button type="button" onClick={() => setMode(isSignUp ? "sign-in" : "sign-up")}>
            {isSignUp ? "Log in" : "Create an account"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-modal="true"
        data-kova-auth-dialog=""
        data-ui-reference="chatgpt-auth-dialog"
        className={cn(
          "kova-auth-surface gap-0 overflow-y-auto bg-background",
          "p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-[450px] sm:pb-5",
          "[&>button.absolute]:!h-11 [&>button.absolute]:!w-11",
        )}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTarget?.isConnected) return;
          event.preventDefault();
          returnFocusTarget.focus();
        }}
      >
        {/* Header */}
        <div className="kova-auth-dialog-heading flex flex-col items-center text-center">
          <div className="kova-auth-dialog-mark mb-6">
            <NovaLogo mark className="h-8 w-8 text-foreground" />
          </div>

          <DialogTitle className="kova-auth-dialog-title text-[32px] font-medium leading-[38px] tracking-[-0.02em]">
            {step === "magic-sent"
              ? "Sign-in link requested"
              : isSignUp
                ? "Create your Kova account"
                : "Log in to Kova"}
          </DialogTitle>
          <DialogDescription className="kova-auth-dialog-description mt-2 max-w-[320px] text-[14px]">
            {step === "magic-sent"
              ? `We asked our email provider to send a sign-in link to ${email}. Delivery can take a few minutes — check your spam folder too.`
              : isSignUp
                ? "Create an account to save your chats and pick up where you left off."
                : "Welcome back. Log in to continue."}
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="kova-auth-body kova-auth-dialog-body mt-6 space-y-3">
          {step === "identify" && (
            <>
              <form onSubmit={handleContinueEmail} className="space-y-3">
                <div>
                  <label htmlFor="kova-auth-email" className="mb-2 block text-sm">
                    Email address
                  </label>
                  <Input
                    id="kova-auth-email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={320}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (
                        nextTarget instanceof HTMLElement &&
                        nextTarget.closest("[data-kova-dialog-close]")
                      ) {
                        return;
                      }
                      setEmailTouched(true);
                    }}
                    aria-invalid={emailTouched && !emailValid}
                    aria-describedby={
                      emailTouched && !emailValid ? "kova-auth-email-error" : undefined
                    }
                    className={cn(
                      "h-12 rounded-full text-base px-4",
                      emailTouched &&
                        !emailValid &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {emailTouched && !emailValid && (
                    <p id="kova-auth-email-error" className="mt-1.5 text-xs text-destructive px-1">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={loading || !emailValid}
                  className="w-full h-12 rounded-full px-5 text-base font-medium"
                >
                  Continue
                </Button>
              </form>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/60" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-3 text-xs tracking-wider text-muted-foreground">
                    OR
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleGithub()}
                disabled={loading || !githubAvailable}
                aria-busy={loadingMethod === "github"}
                aria-describedby={!githubAvailable ? "github-sign-in-status" : undefined}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-4 text-base font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {loadingMethod === "github" ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <img src={githubLogo} alt="" className="h-5 w-5 dark:invert" aria-hidden="true" />
                )}
                Continue with GitHub
              </button>
              {!githubAvailable ? (
                <p
                  id="github-sign-in-status"
                  role="status"
                  className="text-xs text-muted-foreground"
                >
                  {!providers.resolved && !providers.error && browserKovaAuthMode() !== "kova"
                    ? "Checking GitHub availability…"
                    : "GitHub sign-in is currently unavailable. Continue with email or Google."}
                </p>
              ) : null}

              {googleUnavailable || googleCheckFailed ? (
                hostedGoogleAvailable || hostedGooglePending ? null : (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left text-[13px] text-muted-foreground"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>
                      {showHostedGoogle && providers.error
                        ? "Existing Google sign-in couldn't be checked. Close this dialog and try again."
                        : googleUnavailable
                          ? GOOGLE_UNCONFIGURED_MESSAGE
                          : "Google sign-in status couldn't be checked. Continue with your email address."}
                    </span>
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading || !googleAvailable}
                  aria-busy={loading || (!useKovaAuth && !providers.resolved)}
                  className="w-full h-12 rounded-full border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-2 px-4 text-base font-medium disabled:opacity-60"
                >
                  {loadingMethod === "google" || (!useKovaAuth && !providers.resolved) ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span aria-live="polite">
                    {googleAvailable ? "Continue with Google" : "Checking Google availability…"}
                  </span>
                </button>
              )}

              {hostedGoogleAvailable || hostedGooglePending ? (
                <button
                  type="button"
                  onClick={handleHostedGoogle}
                  disabled={loading || !hostedGoogleAvailable}
                  aria-busy={loadingMethod === "hosted-google" || hostedGooglePending}
                  className="w-full h-12 rounded-full border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-2 px-4 text-base font-medium disabled:opacity-60"
                >
                  {loadingMethod === "hosted-google" || hostedGooglePending ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span aria-live="polite">Log in with existing Google</span>
                </button>
              ) : null}

              {!useKovaAuth ? (
                <button
                  type="button"
                  onClick={() => void requestMagicLink(false)}
                  disabled={loading || !emailValid}
                  className="w-full h-12 rounded-full border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-2 px-4 text-base font-medium disabled:opacity-60"
                >
                  Email me a sign-in link
                </button>
              ) : null}
            </>
          )}

          {step === "magic-sent" && (
            <div className="animate-in fade-in-0 duration-100 space-y-3">
              <Button
                type="button"
                variant="outline"
                disabled={loading || cooldown > 0}
                onClick={() => void requestMagicLink(true)}
                className="w-full h-12 rounded-full px-4 text-sm"
              >
                {cooldown > 0 ? `Retry in ${cooldown}s (local delay)` : "Resend the link"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setCooldown(0);
                }}
                className="w-full h-12 rounded-full px-4 text-sm text-muted-foreground hover:text-foreground transition inline-flex items-center justify-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" /> Use a different email
              </button>
            </div>
          )}
        </div>

        {/* Footer toggle */}
        {step !== "magic-sent" && (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-4 font-medium text-foreground underline underline-offset-2"
                  onClick={() => {
                    setMode("sign-in");
                    setStep("identify");
                  }}
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                New to KovaGPT?{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-4 font-medium text-foreground underline underline-offset-2"
                  onClick={() => {
                    setMode("sign-up");
                    setStep("identify");
                  }}
                >
                  Create an account
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
