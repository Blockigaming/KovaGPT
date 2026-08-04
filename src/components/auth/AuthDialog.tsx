import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, ArrowLeft, Sparkles } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";
import { getOAuthRedirectUri, rememberPostAuthRedirect } from "@/lib/oauth-session";
import { cn } from "@/lib/utils";

type Mode = "sign-in" | "sign-up";
type Step = "identify" | "password" | "magic-sent";

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
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep("identify");
    setEmail("");
    setPassword("");
    setFullName("");
    setShowPassword(false);
    setEmailTouched(false);
  }, [initialMode, open]);

  const isSignUp = mode === "sign-up";
  const emailValid = isValidEmail(email);

  const guard = () => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setLoading(true);
    return true;
  };
  const release = () => {
    submittingRef.current = false;
    setLoading(false);
  };

  const handleContinueEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (!emailValid) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setStep("password");
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (!guard()) return;
    try {
      if (isSignUp) {
        const normalizedEmail = email.trim().toLowerCase();
        const metadata: Record<string, string> = {};
        if (fullName.trim()) metadata.full_name = fullName.trim();
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: metadata,
          },
        });
        if (error) throw error;
        // Keep duplicate-account behavior indistinguishable to prevent email
        // enumeration. Supabase decides whether a message should be delivered.
        toast.success("If this address can be registered, check your inbox to continue.");
        onOpenChange(false);
      } else {
        const normalizedEmail = email.trim().toLowerCase();
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) {
          // Do not distinguish unknown, unverified, or incorrect-password
          // accounts. Different responses turn this form into an email
          // enumeration oracle.
          console.error("[KovaAuth] Password authentication was rejected", {
            error: error.name || "auth_error",
          });
          toast.error("That email and password could not be verified.");
          return;
        }
        toast.success("Welcome back.");
        onOpenChange(false);
      }
    } catch (err) {
      console.error("[KovaAuth] Email authentication failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("Authentication could not be completed. Please try again.");
    } finally {
      release();
    }
  };

  const handleGoogle = async () => {
    if (!guard()) return;
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

  const handleMagicLink = async () => {
    if (!emailValid) {
      setEmailTouched(true);
      toast.error("Enter a valid email first.");
      return;
    }
    if (!guard()) return;
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      setStep("magic-sent");
    } catch (err) {
      console.error("[KovaAuth] Magic-link request failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("The sign-in link could not be requested. Please try again.");
    } finally {
      release();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[440px] p-0 border-0 bg-transparent shadow-none overflow-visible [&>button.absolute]:hidden"
          onCloseAutoFocus={(event) => {
            if (!returnFocusTarget?.isConnected) return;
            event.preventDefault();
            returnFocusTarget.focus();
          }}
        >
          <DialogTitle className="sr-only">
            {isSignUp ? "Create your account" : "Log in or sign up"}
          </DialogTitle>

          <div
            className={cn(
              "kova-auth-surface relative rounded-xl border border-border/60 bg-card",
              "p-7 sm:p-9",
              "animate-in fade-in-0 duration-100",
            )}
          >
            {/* Header */}
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 animate-in fade-in-0 duration-100">
                <NovaLogo mark className="h-11 w-11 text-foreground" />
              </div>


              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
                {step === "magic-sent"
                  ? "Check your email"
                  : isSignUp
                    ? "Create your account"
                    : "Log in or sign up"}
              </h1>
              <p className="mt-2 text-[15px] text-muted-foreground max-w-[320px]">
                {step === "magic-sent"
                  ? `We sent a sign-in link to ${email}. Open it on this device to continue.`
                  : "You'll get smarter responses, save your chats, and access KovaGPT across devices."}
              </p>
            </div>

            {/* Body */}
            <div className="mt-7 space-y-3">
              {step === "identify" && (
                <>
                  <form onSubmit={handleContinueEmail} className="space-y-3">
                    <div>
                      <Input
                        type="email"
                        autoComplete="email"
                        autoFocus
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        maxLength={320}
                        onBlur={() => setEmailTouched(true)}
                        aria-invalid={emailTouched && !emailValid}
                        className={cn(
                          "h-14 rounded-xl text-[15px] px-4",
                          emailTouched &&
                            !emailValid &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                      {emailTouched && !emailValid && email.length > 0 && (
                        <p className="mt-1.5 text-xs text-destructive px-1">
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

                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={loading}
                    className="w-full h-14 rounded-xl border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-3 text-[15px] font-medium disabled:opacity-60"
                  >
                    {loading ? (
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
                    Continue with Google
                  </button>

                  <button
                    type="button"
                    onClick={handleMagicLink}
                    disabled={loading || !emailValid}
                    className="w-full h-14 rounded-xl border border-border bg-background hover:bg-accent transition flex items-center justify-center gap-3 text-[15px] font-medium disabled:opacity-60"
                  >
                    Email me a sign-in link

                  </button>
                </>
              )}

              {step === "password" && (
                <form onSubmit={handleAuth} className="space-y-3 animate-in fade-in-0 duration-100">
                  <button
                    type="button"
                    onClick={() => setStep("identify")}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-1"
                  >
                    <ArrowLeft className="h-4 w-4" /> {email}
                  </button>

                  {isSignUp && (
                    <Input
                      type="text"
                      autoComplete="name"
                      placeholder="Your name (optional)"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      maxLength={80}
                      className="h-14 rounded-xl text-[15px] px-4"
                    />
                  )}

                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete={isSignUp ? "new-password" : "current-password"}
                      autoFocus
                      placeholder={isSignUp ? "Create a password (min 6)" : "Password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={6}
                      maxLength={1024}
                      className="h-14 rounded-xl text-[15px] px-4 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {!isSignUp && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setForgotOpen(true)}
                        className="text-sm font-medium text-foreground/80 hover:text-foreground underline underline-offset-2"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-14 rounded-xl text-[15px] font-medium"
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isSignUp ? "Create account" : "Sign in"}
                  </Button>

                  <button
                    type="button"
                    onClick={handleMagicLink}
                    disabled={loading}
                    className="w-full h-12 rounded-xl text-sm text-muted-foreground hover:text-foreground transition inline-flex items-center justify-center"
                  >
                    Email me a link instead
                  </button>
                </form>
              )}

              {step === "magic-sent" && (
                <div className="animate-in fade-in-0 duration-100 space-y-3">
                  <button
                    type="button"
                    onClick={() => setStep("identify")}
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
                      className="text-foreground font-medium underline underline-offset-2"
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
                      className="text-foreground font-medium underline underline-offset-2"
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

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-background border border-border shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </>
  );
}
