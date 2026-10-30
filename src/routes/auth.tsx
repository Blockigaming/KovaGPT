import { createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NovaLogo } from "@/components/NovaLogo";
import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";
import { supabase } from "@/integrations/supabase/client";
import { getEmailAuthRedirectUri, getSafePostAuthRedirect } from "@/lib/oauth-session";
import { browserKovaAuthEnabled, kovaPublicAuthJson } from "@/lib/kova-auth-browser";
import { signInWithKovaPasskey } from "@/lib/kova-auth-passkey-browser";
import { browserSupportsPasskeys } from "@/lib/passkey-support";
import { cn } from "@/lib/utils";
import { authRetryDelay } from "@/lib/auth-retry-delay.mjs";

type AuthSearch = {
  email?: string;
  mode?: "sign-in" | "sign-up";
  googleMfa?: boolean;
  returnTo?: string;
};

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    email: typeof search.email === "string" ? search.email.trim() : undefined,
    mode: search.mode === "sign-up" ? "sign-up" : "sign-in",
    googleMfa: search.google_mfa === "1",
    returnTo: typeof search.return_to === "string" ? search.return_to : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.email && isValidEmail(search.email)) return;
    throw redirect({
      href: `/?${search.mode === "sign-up" ? "sign-up" : "sign-in"}=1`,
      replace: true,
      reloadDocument: true,
      statusCode: 302,
    });
  },
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "KovaGPT Account" },
      {
        name: "description",
        content: "Sign in or create your KovaGPT account securely.",
      },
      { property: "og:title", content: "KovaGPT Account" },
      {
        property: "og:description",
        content: "Sign in or create your KovaGPT account securely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const RESEND_COOLDOWN_SECONDS = 45;

function isValidEmail(value: string) {
  const normalized = value.trim();
  return (
    normalized.length >= 1 &&
    normalized.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  );
}

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const isSignUp = search.mode === "sign-up";
  const useKovaAuth = browserKovaAuthEnabled();
  const minimumPasswordLength = useKovaAuth ? 12 : 6;

  const [email, setEmail] = useState(search.email ?? "");
  const [editingEmail, setEditingEmail] = useState(!search.email);
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"totp" | "recovery">("totp");
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const authFeedbackRef = useRef<{
    toastId?: string | number;
    field?: "password";
    revision: number;
    active: boolean;
  }>({ revision: 0, active: true });

  useEffect(() => {
    const feedback = authFeedbackRef.current;
    feedback.active = true;
    return () => {
      // A pending request must not restore account feedback after leaving its context.
      feedback.active = false;
      feedback.revision += 1;
      if (feedback.toastId !== undefined) toast.dismiss(feedback.toastId);
      feedback.toastId = undefined;
      feedback.field = undefined;
    };
  }, [
    email,
    search.email,
    search.mode,
    search.googleMfa,
    mfaMethod,
    mfaChallengeToken,
    magicSent,
    forgotOpen,
  ]);

  const clearAuthError = () => {
    const feedback = authFeedbackRef.current;
    feedback.revision += 1;
    if (feedback.toastId !== undefined) toast.dismiss(feedback.toastId);
    // Sonner queues dismissals; do not let an old dismissal remove a fast retry's error.
    feedback.toastId = undefined;
    feedback.field = undefined;
  };
  const showAuthError = (message: string, revision?: number, field?: "password") => {
    const feedback = authFeedbackRef.current;
    if (!feedback.active || (revision !== undefined && revision !== feedback.revision)) return;
    // Synchronous validation replaces the previous attempt, just like an accepted retry.
    if (revision === undefined) feedback.revision += 1;
    feedback.field = field;
    feedback.toastId = toast.error(message, {
      id: feedback.toastId,
      duration: Infinity,
      closeButton: true,
      onDismiss: (dismissed) => {
        if (feedback.toastId === dismissed.id) {
          feedback.toastId = undefined;
          feedback.field = undefined;
        }
      },
    });
  };

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
  }, []);

  useEffect(() => {
    setEmail(search.email ?? "");
    setEditingEmail(!search.email);
    setEmailTouched(false);
    setPasswordTouched(false);
    setMfaChallengeToken(null);
    setMfaCode("");
    setMfaMethod("totp");
  }, [search.email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const emailValid = isValidEmail(email);
  const hasMfaChallenge = Boolean(mfaChallengeToken) || search.googleMfa === true;
  const showEmailError = editingEmail && emailTouched && !emailValid;
  const showPasswordError = passwordTouched && password.length < minimumPasswordLength;

  const guard = () => {
    if (submittingRef.current) return false;
    clearAuthError();
    submittingRef.current = true;
    setLoading(true);
    return true;
  };
  const release = () => {
    submittingRef.current = false;
    setLoading(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailTouched(true);
    setPasswordTouched(true);
    if (!emailValid) {
      showAuthError("Please enter a valid email address.");
      return;
    }
    if (password.length < minimumPasswordLength) {
      showAuthError(
        `Password must be at least ${minimumPasswordLength} characters.`,
        undefined,
        "password",
      );
      return;
    }
    if (!guard()) return;
    const feedbackRevision = authFeedbackRef.current.revision;
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (useKovaAuth) {
        const response = await kovaPublicAuthJson(
          isSignUp ? "/api/auth/signup" : "/api/auth/login",
          {
            email: normalizedEmail,
            password,
            ...(isSignUp && fullName.trim() ? { displayName: fullName.trim() } : {}),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          mfaRequired?: unknown;
          challengeToken?: unknown;
        };
        if (!response.ok) {
          showAuthError(
            typeof payload.error === "string"
              ? payload.error
              : "Authentication could not be completed. Please try again.",
            feedbackRevision,
          );
          return;
        }
        if (isSignUp) {
          toast.success("If this address can be registered, check your inbox to continue.");
          void navigate({ to: "/" });
          return;
        }
        if (payload.mfaRequired === true && typeof payload.challengeToken === "string") {
          setMfaChallengeToken(payload.challengeToken);
          setMfaCode("");
          setMfaMethod("totp");
          return;
        }
        toast.success("Welcome back.");
        window.location.replace(getSafePostAuthRedirect());
        return;
      }
      if (isSignUp) {
        const metadata: Record<string, string> = {};
        if (fullName.trim()) metadata.full_name = fullName.trim();
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: getEmailAuthRedirectUri(), data: metadata },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Welcome to KovaGPT.");
          window.location.replace(getSafePostAuthRedirect());
          return;
        }
        toast.success("If this address can be registered, check your inbox to continue.");
        void navigate({ to: "/" });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        console.error("[KovaAuth] Password authentication was rejected", {
          error: error.name || "auth_error",
        });
        showAuthError("That email and password could not be verified.", feedbackRevision);
        return;
      }
      toast.success("Welcome back.");
      window.location.replace(getSafePostAuthRedirect());
    } catch (err) {
      console.error("[KovaAuth] Email authentication failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      showAuthError("Authentication could not be completed. Please try again.", feedbackRevision);
    } finally {
      release();
    }
  };

  const submitMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    const mfaInputValid = mfaMethod === "totp" ? /^\d{6}$/u.test(mfaCode) : mfaCode.length > 0;
    if (!hasMfaChallenge || !mfaInputValid || !guard()) return;
    const feedbackRevision = authFeedbackRef.current.revision;
    try {
      const response = await kovaPublicAuthJson("/api/auth/login", {
        ...(search.googleMfa ? { googleMfa: true } : { challengeToken: mfaChallengeToken }),
        ...(mfaMethod === "totp" ? { code: mfaCode } : { recoveryCode: mfaCode }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) {
        showAuthError(
          typeof payload.error === "string"
            ? payload.error
            : "Two-factor verification could not be completed.",
          feedbackRevision,
        );
        return;
      }
      toast.success("Welcome back.");
      window.location.replace(
        getSafePostAuthRedirect(search.googleMfa ? search.returnTo : undefined),
      );
    } catch (error) {
      console.error("[KovaAuth] MFA authentication failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      showAuthError("Two-factor verification could not be completed.", feedbackRevision);
    } finally {
      release();
    }
  };

  const submitPasskey = async () => {
    if (!useKovaAuth || !browserSupportsPasskeys() || !guard()) return;
    const feedbackRevision = authFeedbackRef.current.revision;
    try {
      await signInWithKovaPasskey();
      setPassword("");
      setMfaCode("");
      setMfaChallengeToken(null);
      setMfaMethod("totp");
      window.location.replace(getSafePostAuthRedirect());
    } catch {
      showAuthError("Passkey sign-in was cancelled or could not be completed.", feedbackRevision);
    } finally {
      release();
    }
  };

  const sendMagicLink = async (resend = false) => {
    if (!emailValid) {
      showAuthError("Enter a valid email first.");
      return;
    }
    if (cooldown > 0) return;
    if (!guard()) return;
    const feedbackRevision = authFeedbackRef.current.revision;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: getEmailAuthRedirectUri() },
      });
      if (error) throw error;
      setMagicSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (resend) toast.success("Another link was requested.");
    } catch (err) {
      console.error("[KovaAuth] Magic-link request failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      showAuthError("The sign-in link could not be requested. Please try again.", feedbackRevision);
    } finally {
      release();
    }
  };

  const resendVerification = async () => {
    if (!emailValid || cooldown > 0 || !guard()) return;
    const feedbackRevision = authFeedbackRef.current.revision;
    try {
      const response = await kovaPublicAuthJson("/api/auth/verify/resend", {
        email: email.trim().toLowerCase(),
      });
      const retryDelay = authRetryDelay(response.headers.get("Retry-After"));
      if (retryDelay !== null) setCooldown(retryDelay);
      if (!response.ok) throw new Error("verification_unavailable");
      if (retryDelay === null) setCooldown(60);
      toast.success("If verification is available for this address, check your inbox.");
    } catch {
      showAuthError("Verification could not be requested. Please try again.", feedbackRevision);
    } finally {
      release();
    }
  };

  return (
    <div
      data-ui-reference="chatgpt-auth-form"
      className="kova-auth-page min-h-screen bg-background"
    >
      <header className="flex h-14 items-center px-4">
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[400px] flex-col px-6 pb-16 pt-6 sm:pt-16"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <NovaLogo mark className="mb-6 h-8 w-8 text-foreground" />
          <h1 className="text-[32px] font-medium leading-[38px] tracking-[-0.02em]">
            {hasMfaChallenge
              ? "Two-factor verification"
              : magicSent
                ? "Sign-in link requested"
                : isSignUp
                  ? "Create your Kova account"
                  : "Log in to Kova"}
          </h1>
          {hasMfaChallenge ? (
            <p className="mt-3 text-base text-muted-foreground">
              {mfaMethod === "totp"
                ? "Enter the 6-digit code from your authenticator app to finish signing in."
                : "Enter one of the recovery codes you saved when you enabled two-factor authentication."}
            </p>
          ) : null}
          {magicSent ? (
            <p className="mt-3 text-base text-muted-foreground">
              We asked our email provider to send a sign-in link to {email}. Delivery can take a few
              minutes — check your spam folder too, then open the link on this device.
            </p>
          ) : null}
        </div>

        {useKovaAuth && !isSignUp && !hasMfaChallenge && passkeySupported ? (
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={submitPasskey}
            className="mb-4 h-12 w-full rounded-full"
          >
            Continue with a passkey
          </Button>
        ) : null}
        {hasMfaChallenge ? (
          <form onSubmit={submitMfa} className="space-y-3">
            <Label htmlFor="kova-auth-page-mfa" className="sr-only">
              {mfaMethod === "totp" ? "Authenticator code" : "Recovery code"}
            </Label>
            <Input
              id="kova-auth-page-mfa"
              autoFocus
              autoComplete={mfaMethod === "totp" ? "one-time-code" : "off"}
              inputMode={mfaMethod === "totp" ? "numeric" : "text"}
              aria-label={mfaMethod === "totp" ? "Authenticator code" : "Recovery code"}
              placeholder={mfaMethod === "totp" ? "123456" : "Recovery code"}
              value={mfaCode}
              onChange={(event) =>
                setMfaCode(
                  mfaMethod === "totp"
                    ? event.target.value.replace(/\D/g, "").slice(0, 6)
                    : event.target.value.slice(0, 256),
                )
              }
              disabled={loading}
              spellCheck={false}
              className={cn(
                "h-12 rounded-full text-center font-mono text-lg",
                mfaMethod === "totp" && "tracking-[0.35em]",
              )}
            />
            <Button
              type="submit"
              disabled={
                loading || (mfaMethod === "totp" ? mfaCode.length !== 6 : mfaCode.length === 0)
              }
              className="h-12 w-full rounded-full text-base"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify and sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              className="h-12 w-full rounded-full text-sm text-muted-foreground"
              onClick={() => {
                setMfaMethod((method) => (method === "totp" ? "recovery" : "totp"));
                setMfaCode("");
              }}
            >
              {mfaMethod === "totp" ? "Use a recovery code" : "Use an authenticator code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              className="h-12 w-full rounded-full text-sm text-muted-foreground"
              onClick={() => {
                setMfaChallengeToken(null);
                setMfaCode("");
                setMfaMethod("totp");
                setPassword("");
                setPasswordTouched(false);
                setShowPassword(false);
                if (search.googleMfa) void navigate({ to: "/" });
                else window.requestAnimationFrame(() => passwordInputRef.current?.focus());
              }}
            >
              {search.googleMfa ? "Cancel" : "Back to password"}
            </Button>
          </form>
        ) : magicSent ? (
          <div className="space-y-3">
            <Button
              variant="outline"
              disabled={loading || cooldown > 0}
              className="h-12 w-full rounded-full text-base"
              onClick={() => void sendMagicLink(true)}
            >
              {cooldown > 0 ? `Retry in ${cooldown}s (local delay)` : "Resend the link"}
            </Button>
            <Button
              variant="ghost"
              className="h-12 w-full rounded-full text-sm text-muted-foreground"
              onClick={() => {
                setMagicSent(false);
                setCooldown(0);
                setEditingEmail(true);
                setEmailTouched(false);
                setPassword("");
                setPasswordTouched(false);
                window.requestAnimationFrame(() => emailInputRef.current?.focus());
              }}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="kova-auth-page-email" className="px-1 text-sm">
                Email address
              </Label>
              <div className="relative">
                <Input
                  ref={emailInputRef}
                  id="kova-auth-page-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  readOnly={!editingEmail}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  maxLength={320}
                  placeholder="Email address"
                  aria-invalid={showEmailError}
                  aria-describedby={showEmailError ? "kova-auth-page-email-error" : undefined}
                  className={cn(
                    "h-12 rounded-full px-4 pr-16 text-base",
                    !editingEmail && "text-muted-foreground",
                  )}
                />
                {!editingEmail ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEmail(true);
                      setEmailTouched(false);
                      window.requestAnimationFrame(() => emailInputRef.current?.focus());
                    }}
                    className="absolute right-1.5 top-1/2 inline-flex h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-lg px-2 text-sm font-medium text-foreground underline underline-offset-2 transition hover:bg-accent"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              {showEmailError ? (
                <p id="kova-auth-page-email-error" className="px-1 text-xs text-destructive">
                  Enter a valid email address.
                </p>
              ) : null}
            </div>

            {isSignUp ? (
              <div className="space-y-2">
                <Label htmlFor="kova-auth-page-name" className="px-1 text-sm">
                  Name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="kova-auth-page-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  maxLength={80}
                  className="h-12 rounded-full px-4 text-base"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="kova-auth-page-password" className="px-1 text-sm">
                Password
              </Label>
              <div className="relative">
                <Input
                  ref={passwordInputRef}
                  id="kova-auth-page-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  autoFocus
                  placeholder="Password"
                  value={password}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPassword(value);
                    if (
                      value.length >= minimumPasswordLength &&
                      authFeedbackRef.current.field === "password"
                    ) {
                      clearAuthError();
                    }
                  }}
                  onBlur={() => {
                    if (password.length > 0) setPasswordTouched(true);
                  }}
                  minLength={minimumPasswordLength}
                  maxLength={1024}
                  aria-invalid={showPasswordError}
                  aria-describedby="kova-auth-page-password-requirement"
                  className="h-12 rounded-full px-4 pr-14 text-base"
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setShowPassword((value) => !value);
                    passwordInputRef.current?.focus();
                  }}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p
                id="kova-auth-page-password-requirement"
                className={cn(
                  "px-1 text-xs",
                  showPasswordError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                Use at least {minimumPasswordLength} characters.
              </p>
            </div>

            {!isSignUp ? (
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-foreground underline underline-offset-2"
              >
                Forgot password?
              </button>
            ) : null}

            <Button
              type="submit"
              disabled={loading || !emailValid || password.length < minimumPasswordLength}
              className="h-12 w-full rounded-full text-base font-medium"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isSignUp ? "Create account" : "Log in"}
            </Button>

            {useKovaAuth ? (
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={loading || !emailValid || cooldown > 0}
                className="h-12 w-full rounded-full text-sm text-muted-foreground transition hover:text-foreground"
              >
                {cooldown > 0 ? `Retry in ${cooldown}s (local delay)` : "Resend verification email"}
              </button>
            ) : null}
            {!useKovaAuth ? (
              <button
                type="button"
                onClick={() => void sendMagicLink(false)}
                disabled={loading || !emailValid}
                className="h-12 w-full rounded-full text-sm text-muted-foreground transition hover:text-foreground"
              >
                Email me a link instead
              </button>
            ) : null}
          </form>
        )}
        <nav
          aria-label="Account policies"
          className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Terms of Service (opens in a new tab)"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Privacy Policy (opens in a new tab)"
          >
            Privacy Policy
          </a>
        </nav>
      </main>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} initialEmail={email} />
    </div>
  );
}
