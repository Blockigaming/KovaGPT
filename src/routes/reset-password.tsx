import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  getSupabaseClientConfigStatus,
  resolveLegacyAuthContext,
} from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NovaLogo } from "@/components/NovaLogo";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  clearPasswordRecoveryFlow,
  markPasswordRecoveryFlow,
  completeOAuthSessionFromUrl,
  clearOAuthResponseFromUrl,
} from "@/lib/oauth-session";
import {
  browserKovaAuthEnabled,
  browserKovaAuthMode,
  kovaPublicAuthJson,
} from "@/lib/kova-auth-browser";
import { readKovaRecoveryLanding } from "@/lib/kova-recovery-landing.mjs";

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
      { name: "referrer", content: "no-referrer" },
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
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const recoveryLanding = useRef<ReturnType<typeof readKovaRecoveryLanding> | null>(null);
  const legacyContext = useRef<{
    context: Awaited<ReturnType<typeof resolveLegacyAuthContext>>;
    userId: string;
  } | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const useKovaRecovery = browserKovaAuthEnabled() && recoveryToken !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Capture only in memory and remove the credential before showing any form.
    // The ref also survives React's development effect replay after URL cleanup.
    if (!recoveryLanding.current) {
      try {
        const landing = readKovaRecoveryLanding(window.location.href, browserKovaAuthMode());
        if (landing.cleanUrl !== null)
          window.history.replaceState(null, document.title, landing.cleanUrl);
        recoveryLanding.current = landing;
      } catch {
        // A credential that cannot be removed from the URL never enables reset.
        recoveryLanding.current = { owned: true, token: null, cleanUrl: null };
      }
    }
    const landing = recoveryLanding.current;
    if (landing.owned || browserKovaAuthMode() === "kova") {
      if (!landing.owned) clearOAuthResponseFromUrl();
      setRecoveryToken(landing.token);
      setReady(true);
      if (!browserKovaAuthEnabled() || !landing.token) {
        setError(
          "This reset link is invalid or has expired. Request a new one from the sign-in screen.",
        );
      }
      return;
    }
    if (!getSupabaseClientConfigStatus().configured) {
      setReady(true);
      setError("Account recovery is temporarily unavailable. Please try again later.");
      return;
    }
    // One explicit callback exchange owns recovery. Neither SDK initialization
    // nor the app bootstrap may race this route and consume its code first.
    let cancelled = false;
    let settled = false;
    const controller = new AbortController();
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
    const check = async () => {
      try {
        const session = await completeOAuthSessionFromUrl("password recovery", controller.signal, {
          recoveryOnly: true,
        });
        if (cancelled) return;
        if (!session) {
          finish(false);
          return;
        }
        const context = await resolveLegacyAuthContext();
        if (cancelled) return;
        context.assertCurrent();
        legacyContext.current = { context, userId: session.user.id };
        markPasswordRecoveryFlow(session.user.id);
        finish(true);
      } catch {
        clearPasswordRecoveryFlow();
        finish(false);
      }
    };
    void check();
    const t = window.setTimeout(() => {
      if (settled) return;
      finish(false);
      cancelled = true;
      controller.abort();
    }, 15_000);
    return () => {
      cancelled = true;
      controller.abort();
      legacyContext.current = null;
      window.clearTimeout(t);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || !ready || error) return;
    const minimumLength = useKovaRecovery ? 12 : 6;
    if (password.length < minimumLength) {
      toast.error(`Password must be at least ${minimumLength} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    submitting.current = true;
    try {
      if (useKovaRecovery && recoveryToken) {
        const response = await kovaPublicAuthJson("/api/auth/recovery/reset", {
          token: recoveryToken,
          password,
        });
        const payload = (await response.json().catch(() => null)) as {
          session?: { accountId?: unknown; emailVerified?: unknown };
          error?: unknown;
        } | null;
        if (
          !response.ok ||
          typeof payload?.session?.accountId !== "string" ||
          payload.session.emailVerified !== true
        )
          throw new Error("recovery_response_unconfirmed");
        if (!mounted.current) return;
        recoveryLanding.current = null;
        setRecoveryToken(null);
        window.history.replaceState({}, document.title, "/reset-password");
        toast.success("Password updated and other sessions signed out.");
        window.location.replace("/");
        return;
      }
      const boundary = legacyContext.current;
      if (!boundary) throw new Error("recovery_session_unavailable");
      boundary.context.assertCurrent();
      const current = await boundary.context.auth.getSession();
      if (!mounted.current) return;
      boundary.context.assertCurrent();
      if (current.error || current.data.session?.user.id !== boundary.userId)
        throw new Error("recovery_session_changed");
      const { error: updateErr } = await boundary.context.auth.updateUser({ password });
      boundary.context.assertCurrent();
      if (!mounted.current) return;
      if (updateErr) throw updateErr;
      const { error: signOutError } = await boundary.context.auth.signOut({
        scope: "others",
      });
      boundary.context.assertCurrent();
      if (!mounted.current) return;
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
      if (mounted.current)
        toast.error("Your password could not be updated. Request a new reset link and try again.");
    } finally {
      setPassword("");
      setConfirm("");
      setLoading(false);
      submitting.current = false;
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
                minLength={useKovaRecovery ? 12 : 6}
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
                minLength={useKovaRecovery ? 12 : 6}
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
