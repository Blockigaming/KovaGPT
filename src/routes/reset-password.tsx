import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NovaLogo } from "@/components/NovaLogo";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  clearPasswordRecoveryFlow,
  hasRecentPasswordRecoveryFlow,
  markPasswordRecoveryFlow,
} from "@/lib/oauth-session";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  head: () => ({
    meta: [
      { title: "KovaGPT Password" },
      {
        name: "description",
        content: "Set a new password for your KovaGPT account.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSupabaseClientConfigStatus().configured) {
      setReady(true);
      setError("Account recovery is temporarily unavailable. Please try again later.");
      return;
    }
    // Supabase may need a network round-trip to exchange a recovery code. Listen
    // before checking the current session so a slow exchange is not mislabeled
    // as an expired link.
    let cancelled = false;
    let settled = false;
    const finish = (sessionReady: boolean) => {
      if (cancelled || settled) return;
      settled = true;
      setReady(true);
      setError(
        sessionReady
          ? null
          : "This reset link is invalid or has expired. Request a new one from the sign-in screen.",
      );
    };
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // Supabase may consume the recovery URL (and fire PASSWORD_RECOVERY) before
    // this listener attaches. Treat a recovery-shaped landing URL as proof the
    // visitor arrived from a reset email.
    const arrivedFromResetLink =
      params.get("type") === "recovery" ||
      hash.get("type") === "recovery" ||
      params.has("code") ||
      params.has("token_hash") ||
      hash.has("access_token");
    if (params.get("error") || hash.get("error")) {
      clearPasswordRecoveryFlow();
      finish(false);
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        markPasswordRecoveryFlow(session.user.id);
        finish(true);
        return;
      }
      if (session && (arrivedFromResetLink || hasRecentPasswordRecoveryFlow(session.user.id))) {
        if (arrivedFromResetLink) markPasswordRecoveryFlow(session.user.id);
        finish(true);
      }
    });
    const check = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (
        data.session &&
        (arrivedFromResetLink || hasRecentPasswordRecoveryFlow(data.session.user.id))
      ) {
        if (arrivedFromResetLink) markPasswordRecoveryFlow(data.session.user.id);
        finish(true);
      } else if (sessionError) {
        clearPasswordRecoveryFlow();
        finish(false);
      }
    };
    void check();
    const t = window.setTimeout(() => finish(false), 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "others",
      });
      clearPasswordRecoveryFlow();
      if (signOutError) {
        toast.warning(
          "Password updated, but other sessions could not be signed out. Retry from Security settings.",
        );
      } else {
        toast.success("Password updated and other sessions signed out.");
      }
      navigate({ to: "/" });
    } catch (err) {
      console.error("[KovaAuth] Password update failed", {
        error: err instanceof Error ? err.name : "unknown_error",
      });
      toast.error("Your password could not be updated. Request a new reset link and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="kova-auth-page min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="kova-auth-surface w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-foreground text-background flex items-center justify-center mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Set a new password</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <NovaLogo decorative className="w-4 h-4" /> KovaGPT account recovery
          </p>
        </div>

        {!ready ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="space-y-4">
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              {error}
            </p>
            <Button className="w-full" onClick={() => navigate({ to: "/" })}>
              Back to KovaGPT
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={1024}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                maxLength={1024}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
