import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, KeyRound, Mail } from "lucide-react";
import { browserKovaAuthEnabled, kovaPublicAuthJson } from "@/lib/kova-auth-browser";

export function ForgotPasswordDialog({
  open,
  onOpenChange,
  initialEmail = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialEmail?: string;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const submitting = useRef(false);
  const requestVersion = useRef(0);
  useEffect(() => {
    requestVersion.current += 1;
    submitting.current = false;
    setLoading(false);
    setSent(false);
    setError(null);
    if (open) setEmail(initialEmail);
  }, [open, initialEmail]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || cooldown > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    submitting.current = true;
    const version = requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      if (browserKovaAuthEnabled()) {
        const response = await kovaPublicAuthJson("/api/auth/recovery/request", {
          email: normalizedEmail,
        });
        if (!response.ok) throw new Error(`Kova recovery request failed (${response.status})`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
      }
      if (version !== requestVersion.current) return;
      setSent(true);
      setCooldown(45);
    } catch (err) {
      console.error("[KovaAuth] Password reset request failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      if (version === requestVersion.current)
        setError("A reset link could not be requested. Please try again.");
    } finally {
      if (version === requestVersion.current) {
        submitting.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setSent(false);
          setEmail("");
        }
      }}
    >
      <DialogContent className="kova-auth-surface sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-2xl bg-foreground text-background flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">
            {sent ? "Check your email" : "Reset your password"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {sent
              ? "If this email has an account, a reset link has been requested. Check your inbox and spam folder, then open the newest link on this device."
              : "Enter the email you used to sign up and we'll send you a reset link."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border p-4 text-sm flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="break-all font-medium">{email}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reset links expire. If you requested more than one, use the newest link.
                </p>
              </div>
            </div>
            <Button className="h-12 w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <button
              type="button"
              className="min-h-11 w-full rounded-full text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSent(false)}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" aria-busy={loading}>
            <div className="space-y-1.5">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                disabled={loading}
                className="h-12 rounded-2xl"
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="h-12 w-full" disabled={loading || cooldown > 0}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cooldown > 0 ? `Try again in ${cooldown}s` : "Send reset link"}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              For your privacy, the response is the same whether or not an account exists.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
