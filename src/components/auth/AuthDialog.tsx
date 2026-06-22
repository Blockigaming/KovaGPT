import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || loading) return;
    setMode(initialMode);
    setEmail("");
    setPassword("");
  }, [initialMode, open, loading]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        // Supabase returns success with an empty identities array when the
        // email is already registered but unconfirmed  -  no email is sent
        // in that case. Explicitly trigger a resend so the user always
        // gets a verification email.
        const isRepeat = !!data.user && (data.user.identities?.length ?? 0) === 0;
        if (isRepeat) {
          const { error: resendErr } = await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: `${window.location.origin}/` },
          });
          if (resendErr) throw resendErr;
          toast.success("Already registered  -  we resent the verification link. Check your inbox & spam.");
        } else {
          toast.success("Verification email sent. Check your inbox & spam folder.");
        }
        onOpenChange(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // If user hasn't confirmed yet, automatically resend the verification.
          if (/confirm|not confirmed|email.*verif/i.test(error.message)) {
            await supabase.auth.resend({
              type: "signup",
              email,
              options: { emailRedirectTo: `${window.location.origin}/` },
            });
            toast.error("Please verify your email  -  we just resent the link.");
            return;
          }
          throw error;
        }
        toast.success("Signed in.");
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
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        toast.error(msg);
        setLoading(false);
        return;
      }
      if (result.redirected) return; // browser redirects
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
          <DialogTitle>{mode === "sign-up" ? "Create your account" : "Welcome back"}</DialogTitle>
          <DialogDescription>
            {mode === "sign-up"
              ? "Sign up to save your chats, settings, and history."
              : "Sign in to continue where you left off."}
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
          Continue with Google
        </Button>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
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
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "sign-up" ? "Sign up" : "Sign in"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {mode === "sign-up" ? (
            <>
              Already have an account?{" "}
              <button type="button" className="text-foreground underline" onClick={() => setMode("sign-in")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" className="text-foreground underline" onClick={() => setMode("sign-up")}>
                Create an account
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
