import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { getOAuthRedirectUri, rememberPostAuthRedirect } from "@/lib/oauth-session";
import { useAuthProviders } from "@/hooks/useAuthProviders";
import { GOOGLE_UNCONFIGURED_MESSAGE } from "@/lib/auth-providers";
import { browserSupportsPasskeys } from "@/lib/passkey-support";
import { cn } from "@/lib/utils";

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
}: {
  open: boolean;
  mode: Mode;
  onOpenChange: (open: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("identify");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState<"email" | "google" | "passkey" | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const submittingRef = useRef(false);
  const navigate = useNavigate();
  const providers = useAuthProviders(open);

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

  const isSignUp = mode === "sign-up";
  const emailValid = isValidEmail(email);
  // Only claim Google is available once the deployment has confirmed it.
  const googleAvailable = providers.resolved && providers.google;
  const googleUnavailable = providers.resolved && !providers.google;
  const googleCheckFailed = Boolean(providers.error);

  const guard = (method: "email" | "google" | "passkey") => {
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
    setEmailTouched(true);
    if (!emailValid) {
      toast.error("Please enter a valid email address.");
      return;
    }
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
    try {
      rememberPostAuthRedirect();
      const { providerAuth } = await import("@/integrations/provider-auth");
      const result = await providerAuth.auth.signInWithOAuth("google", {
        redirect_uri: getOAuthRedirectUri(),
      });
      if (result.error) {
        console.error("[KovaAuth] Google authentication could not start", {
          error: result.error instanceof Error ? result.error.name : "provider_error",
        });
        toast.error("Google sign in could not start. Please try again.");
        release();
        return;
      }
      if (result.redirected) return;
      onOpenChange(false);
    } catch (err) {
      console.error("[KovaAuth] Google authentication failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("Google sign in could not start. Please try again.");
    } finally {
      release();
    }
  };

  const handlePasskey = async () => {
    const supported = browserSupportsPasskeys();
    if (!providers.resolved || !providers.passkeys || !supported) {
      toast.error("Passkey sign-in is not available on this browser or deployment.");
      return;
    }
    if (!guard("passkey")) return;
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      onOpenChange(false);
    } catch (error) {
      console.error("[KovaAuth] Passkey authentication failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Passkey sign-in was cancelled or could not be completed.");
    } finally {
      release();
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
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        setStep("magic-sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        if (resend) toast.success("Another link was requested.");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-modal="true"
        className={cn(
          "kova-auth-surface gap-0 overflow-y-auto border-border/60 bg-card shadow-xl",
          "p-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:max-w-[440px] sm:p-9 sm:pb-9",
          "[&>button.absolute]:!h-11 [&>button.absolute]:!w-11",
        )}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTarget?.isConnected) return;
          event.preventDefault();
          returnFocusTarget.focus();
        }}
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 animate-in fade-in-0 duration-100">
            <NovaLogo mark className="h-11 w-11 text-foreground" />
          </div>

          <DialogTitle className="text-[26px] font-semibold leading-tight tracking-tight">
            {step === "magic-sent"
              ? "Sign-in link requested"
              : isSignUp
                ? "Create your account"
                : "Log in or sign up"}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-[320px] text-[15px]">
            {step === "magic-sent"
              ? `We asked our email provider to send a sign-in link to ${email}. Delivery can take a few minutes — check your spam folder too.`
              : "You'll get smarter responses, save your chats, and access KovaGPT across devices."}
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="mt-7 space-y-3">
          {step === "identify" && (
            <>
              <form onSubmit={handleContinueEmail} className="space-y-3">
                <div>
                  <label htmlFor="kova-auth-email" className="sr-only">
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
                      "h-14 rounded-xl text-[15px] px-4",
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
                  className="w-full h-14 rounded-xl text-[15px] font-medium"
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

              {!isSignUp &&
              providers.resolved &&
              providers.passkeys &&
              browserSupportsPasskeys() ? (
                <button
                  type="button"
                  onClick={() => void handlePasskey()}
                  disabled={loading}
                  aria-busy={loadingMethod === "passkey"}
                  className="flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background text-[15px] font-medium transition hover:bg-accent disabled:opacity-60"
                >
                  {loadingMethod === "passkey" ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  )}
                  Continue with a passkey
                </button>
              ) : null}

              {googleUnavailable || googleCheckFailed ? (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left text-[13px] text-muted-foreground"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    {googleUnavailable
                      ? GOOGLE_UNCONFIGURED_MESSAGE
                      : "Google sign-in status couldn't be checked. Continue with your email address."}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading || !googleAvailable}
                  aria-busy={loading || !providers.resolved}
                  className="w-full h-14 rounded-xl border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-3 text-[15px] font-medium disabled:opacity-60"
                >
                  {loadingMethod === "google" || !providers.resolved ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
                      />
                    </svg>
                  )}
                  <span aria-live="polite">
                    {providers.resolved ? "Continue with Google" : "Checking Google availability…"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void requestMagicLink(false)}
                disabled={loading || !emailValid}
                className="w-full h-14 rounded-xl border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-3 text-[15px] font-medium disabled:opacity-60"
              >
                Email me a sign-in link
              </button>
            </>
          )}

          {step === "magic-sent" && (
            <div className="animate-in fade-in-0 duration-100 space-y-3">
              <Button
                type="button"
                variant="outline"
                disabled={loading || cooldown > 0}
                onClick={() => void requestMagicLink(true)}
                className="w-full h-12 rounded-xl text-sm"
              >
                {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend the link"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setCooldown(0);
                }}
                className="w-full h-12 rounded-xl text-sm text-muted-foreground hover:text-foreground transition inline-flex items-center justify-center gap-2"
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
                  className="font-medium text-foreground underline underline-offset-2"
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
                  className="font-medium text-foreground underline underline-offset-2"
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
