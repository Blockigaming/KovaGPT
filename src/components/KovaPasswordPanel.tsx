import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearKovaAuthCache, kovaAuthJson } from "@/lib/kova-auth-browser";
import { toast } from "sonner";

/** Changes an existing owned password; never creates a hosted-auth credential. */
export function KovaPasswordPanel() {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const response = await fetch("/api/auth/password", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = (await response.json()) as { hasPassword?: unknown };
        if (!response.ok || typeof payload.hasPassword !== "boolean") throw new Error("status");
        if (!cancelled) setStatus(payload.hasPassword ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const clearFields = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || status !== "ready" || !editing) return;
    if (
      !currentPassword ||
      newPassword.length < 12 ||
      newPassword !== confirmation ||
      newPassword === currentPassword ||
      new TextEncoder().encode(newPassword).length > 1024
    ) {
      toast.error(
        "Use a different password with at least 12 characters and matching confirmation.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await kovaAuthJson("/api/auth/password", { currentPassword, newPassword });
      const payload = (await response.json()) as { changed?: unknown };
      if (!response.ok || payload.changed !== true) throw new Error("password_change_failed");
      setEditing(false);
      toast.success("Password changed. Other devices have been signed out.");
    } catch {
      toast.error("Password change could not be confirmed. Sign in again before retrying.");
    } finally {
      clearFields();
      clearKovaAuthCache();
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card/60 p-5"
      aria-labelledby="kova-password-heading"
    >
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id="kova-password-heading" className="text-sm font-semibold">
          Password
        </h3>
      </div>
      {status === "loading" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading password settings" />
      ) : status === "error" ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Password settings could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : status === "unavailable" ? (
        <p className="text-xs text-muted-foreground">
          This account does not have a Kova password. Continue using your existing sign-in method.
        </p>
      ) : !editing ? (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Change password
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Verify your current password to set a new one. Other devices will be signed out.
          </p>
          <div className="space-y-1">
            <Label htmlFor="kova-current-password">Current password</Label>
            <Input
              id="kova-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              maxLength={1024}
              disabled={busy}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kova-new-password">New password</Label>
            <Input
              id="kova-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={12}
              maxLength={1024}
              disabled={busy}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kova-confirm-password">Confirm new password</Label>
            <Input
              id="kova-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              minLength={12}
              maxLength={1024}
              disabled={busy}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                busy || !currentPassword || newPassword.length < 12 || newPassword !== confirmation
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Changing password" />
              ) : (
                "Save password"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clearFields();
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
