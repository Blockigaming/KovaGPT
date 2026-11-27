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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearPasswordRecoveryFlow,
  markPasswordRecoveryFlow,
  completeOAuthSessionFromUrl,
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
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const legacyContext = useRef<{
    context: Awaited<ReturnType<typeof resolveLegacyAuthContext>>;
    userId: string;
  } | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
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
        if (cancelled) return;
        clearPasswordRecoveryFlow();
        finish(false);
      }
    };
    // Defer consumption of the one-time URL until synchronous React effect
    // replay has cancelled the first mount. A cancelled effect must not scrub it.
    void Promise.resolve().then(() => {
      if (!cancelled) return check();
    });
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
    const minimumLength = 6;
    if (password.length < minimumLength) {
      toast.error(`Password must be at least ${minimumLength} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSubmitNotice(null);
    setLoading(true);
    submitting.current = true;
    let failureMessage =
      "Your password could not be updated. Request a new reset link and try again.";
    let preserveDraft = false;
    let updatePending = false;
    let updateConfirmed = false;
    try {
      const boundary = legacyContext.current;
      if (!boundary) throw new Error("recovery_session_unavailable");
      boundary.context.assertCurrent();
      const current = await boundary.context.auth.getSession();
      if (!mounted.current) return;
      boundary.context.assertCurrent();
      if (current.error || current.data.session?.user.id !== boundary.userId)
        throw new Error("recovery_session_changed");
      updatePending = true;
      const { error: updateErr } = await boundary.context.auth.updateUser({ password });
      updatePending = false;
      if (updateErr) {
        if (updateErr.status === 429) {
          preserveDraft = true;
          failureMessage = "Wait before retrying your password update.";
        } else if (!updateErr.status || updateErr.status >= 500 || updateErr.status === 408) {
          preserveDraft = true;
          failureMessage =
            "Your password update may have completed. Try signing in with your new password.";
        }
        throw updateErr;
      }
      updateConfirmed = true;
      boundary.context.assertCurrent();
      if (!mounted.current) return;
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
    } catch {
      if (updatePending) {
        preserveDraft = true;
        failureMessage =
          "Your password update may have completed. Try signing in with your new password.";
      } else if (updateConfirmed) {
        clearPasswordRecoveryFlow();
        failureMessage = "Password updated, but session cleanup could not be confirmed.";
      }
      console.error("[KovaAuth] Password update unconfirmed", {
        code: "kova_password_update_unconfirmed",
      });
      if (mounted.current) {
        setSubmitNotice(failureMessage);
        toast.error(failureMessage);
      }
    } finally {
      if (mounted.current) {
        if (!preserveDraft) {
          setPassword("");
          setConfirm("");
        }
        setLoading(false);
      }
      submitting.current = false;
    }
  };

  const leaveRecovery = async () => {
    if (submitting.current) return;
    clearPasswordRecoveryFlow();
    legacyContext.current = null;
    setPassword("");
    setConfirm("");
    await navigate({ to: "/" });
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <div
      data-ui-reference="chatgpt-auth-recovery"
      className="kova-auth-page min-h-screen flex items-center justify-center px-4 py-8 bg-background"
    >
      <div className="kova-auth-surface w-full max-w-[400px] px-6 py-8">
        <div className="flex flex-col items-center text-center mb-6">
          <NovaLogo mark className="mb-6 h-8 w-8" />
          <h1 className="text-[32px] font-medium leading-[38px] tracking-[-0.02em]">
            Set a new password
          </h1>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">KovaGPT account recovery</p>
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
            <Button className="w-full" onClick={() => void leaveRecovery()}>
              Back to KovaGPT
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {submitNotice && (
              <p
                role="status"
                className="text-sm text-muted-foreground rounded-lg border border-border p-3"
              >
                {submitNotice}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                disabled={loading}
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
                disabled={loading}
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
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={loading}
              onClick={() => void leaveRecovery()}
            >
              Cancel
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
