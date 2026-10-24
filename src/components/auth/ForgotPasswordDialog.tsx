import { useCallback, useEffect, useRef, useState } from "react";
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
  initialEmail?: string;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const operationRef = useRef(0);
  const submittingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const reset = useCallback(() => {
    operationRef.current += 1;
    submittingRef.current = false;
    setEmail(initialEmail);
    setSent(false);
    setLoading(false);
  }, [initialEmail]);

  useEffect(() => {
    reset();
    return () => {
      operationRef.current += 1;
    };
  }, [open, reset]);

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    const operation = ++operationRef.current;
    submittingRef.current = true;
    setLoading(true);
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
      if (operationRef.current !== operation) return;
      setSent(true);
      toast.success("If an account exists for this email, you’ll receive recovery instructions.");
    } catch (err) {
      if (operationRef.current !== operation) return;
      console.error("[KovaAuth] Password reset request failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("A reset link could not be requested. Please try again.");
    } finally {
      if (operationRef.current === operation) {
        submittingRef.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          emailRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef.current?.isConnected) return;
          event.preventDefault();
          returnFocusRef.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-2xl bg-foreground text-background flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Reset your password</DialogTitle>
          <DialogDescription className="text-center">
            {sent
              ? "If an account exists for this email, you’ll receive recovery instructions. Open any received link on this device."
              : "Enter your account email to request recovery instructions."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-medium">{email}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reset links expire. If you requested more than one, use the newest link.
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={close}>
              Done
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                reset();
                window.requestAnimationFrame(() => emailRef.current?.focus());
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                ref={emailRef}
                id="fp-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={close}>
              Cancel
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              If an account exists for this email, you’ll receive recovery instructions.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
