import { useState } from "react";
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

export function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Please enter your email.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Reset link sent. Check your inbox & spam folder.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-2xl bg-foreground text-background flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Reset your password</DialogTitle>
          <DialogDescription className="text-center">
            {sent
              ? "We sent a secure reset link to your email. Open it on this device to set a new password."
              : "Enter the email you used to sign up and we'll send you a reset link."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-medium">{email}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The link expires in 1 hour. Didn't get it? Check spam, then try again.
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSent(false)}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              If an account exists for that email, you'll get the link in a minute.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
