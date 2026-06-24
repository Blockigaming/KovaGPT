import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";

type Mode = "sign-in" | "sign-up";

export function AuthDialog({
  open,
  mode: initialMode,
  onOpenChange,
}: {
  open: boolean;
  mode: Mode;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || loading) return;
    setMode(initialMode);
    setEmail("");
    setPassword("");
    setFullName("");
    setPhone("");
  }, [initialMode, open, loading]);

  const isSignUp = mode === "sign-up";

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const metadata: Record<string, string> = {};
        if (fullName.trim()) metadata.full_name = fullName.trim();
        if (phone.trim()) metadata.phone = phone.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: metadata,
          },
        });
        if (error) throw error;
        const isRepeat = !!data.user && (data.user.identities?.length ?? 0) === 0;
        if (isRepeat) {
          const { error: resendErr } = await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: `${window.location.origin}/` },
          });
          if (resendErr) throw resendErr;
          toast.success("Already registered - we resent the verification link. Check your inbox & spam.");
        } else {
          toast.success("Verification email sent. Check your inbox & spam folder.");
        }
        onOpenChange(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/confirm|not confirmed|email.*verif/i.test(error.message)) {
            await supabase.auth.resend({
              type: "signup",
              email,
              options: { emailRedirectTo: `${window.location.origin}/` },
            });
            toast.error("Please verify your email - we just resent the link.");
            return;
          }
          throw error;
        }
        toast.success("Welcome back!");
        onOpenChange(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const { lovable } = await import("@/integrations/lovable");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        toast.error(msg);
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      toast.success("Signed in.");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex justify-center mb-3">
            <div className="relative w-14 h-14 rounded-2xl bg-foreground/5 ring-1 ring-border flex items-center justify-center">
              <NovaLogo className="w-8 h-8" />
              <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-foreground flex items-center justify-center shadow-sm">
                {isSignUp ? (
                  <UserPlus className="w-3.5 h-3.5 text-background" />
                ) : (
                  <LogIn className="w-3.5 h-3.5 text-background" />
                )}
              </span>
            </div>
          </div>
          <div className="flex justify-center mb-1">
            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
              {isSignUp ? "Create account" : "Sign in"}
            </span>
          </div>
          <DialogTitle className="text-center text-xl">
            {isSignUp ? "Join KovaGPT" : "Welcome back to KovaGPT"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isSignUp
              ? "Create your free KovaGPT account to save chats, settings, and history."
              : "Sign in to your KovaGPT account to continue where you left off."}
          </DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogle}
          disabled={loading}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
          </svg>
          {isSignUp ? "Sign up with Google" : "Continue with Google"}
        </Button>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or use email</span>
          </div>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          {isSignUp && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="auth-name" className="flex items-center justify-between">
                  <span>Name</span>
                  <span className="text-xs font-normal text-muted-foreground">Optional</span>
                </Label>
                <Input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  placeholder="What should we call you?"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-phone" className="flex items-center justify-between">
                  <span>Phone number</span>
                  <span className="text-xs font-normal text-muted-foreground">Optional</span>
                </Label>
                <Input
                  id="auth-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+1 555 555 5555"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={32}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">
              {isSignUp ? "Create a password" : "Password"}
            </Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              placeholder={isSignUp ? "At least 6 characters" : undefined}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSignUp ? (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Create my KovaGPT account
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" />
                Sign in to KovaGPT
              </>
            )}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <>
              Already have an account?{" "}
              <button type="button" className="text-foreground font-medium underline" onClick={() => setMode("sign-in")}>
                Sign in instead
              </button>
            </>
          ) : (
            <>
              New to KovaGPT?{" "}
              <button type="button" className="text-foreground font-medium underline" onClick={() => setMode("sign-up")}>
                Create a free account
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
