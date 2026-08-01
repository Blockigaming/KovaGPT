import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type TotpFactor = { id: string; friendly_name?: string | null };

export function MfaChallengeDialog({
  open,
  onVerified,
  onCancel,
}: {
  open: boolean;
  onVerified: (session: Session) => void;
  onCancel: () => void;
}) {
  const [factor, setFactor] = useState<TotpFactor | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFactor(null);
    setCode("");
    setError(null);
    setLoading(true);
    void supabase.auth.mfa
      .listFactors()
      .then(({ data, error: factorError }) => {
        if (cancelled) return;
        const first = data?.totp?.[0] as TotpFactor | undefined;
        if (factorError || !first) {
          setError(
            "Your authenticator could not be loaded. Try signing in again.",
          );
          return;
        }
        setFactor(first);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Your authenticator could not be loaded. Try signing in again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!factor || !/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code,
        });
      if (verifyError || !data.session) {
        setError(
          "That code was not accepted. Check your authenticator and try again.",
        );
        return;
      }
      onVerified(data.session);
    } catch {
      setError(
        "Two-factor verification is temporarily unavailable. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => loading && event.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <KeyRound className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">
            Two-factor verification
          </DialogTitle>
          <DialogDescription className="text-center">
            Enter the 6-digit code from your authenticator app to finish signing
            in.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        <form onSubmit={verify} className="space-y-3">
          <Input
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            aria-label="Authenticator code"
            placeholder="123456"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            disabled={loading || !factor}
            className="text-center font-mono tracking-[0.35em]"
          />
          <Button
            className="w-full"
            type="submit"
            disabled={loading || !factor || code.length !== 6}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel sign in
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
