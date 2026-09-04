import { useEffect, useState } from "react";
import { ShieldCheck, KeyRound, LogOut, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PasskeyPanel } from "@/components/PasskeyPanel";

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * Real MFA UI using Supabase auth.mfa. Handles TOTP enroll, verify, unenroll,
 * plus a "sign out other sessions" action. Recovery codes are intentionally
 * not displayed because Supabase TOTP does not issue server-verifiable codes.
 */
export function MfaPanel() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<null | {
    factorId: string;
    qr: string;
    secret: string;
    uri: string;
  }>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const all = [...(data?.totp ?? [])] as Factor[];
      setFactors(all);
    } catch (error) {
      setFactors([]);
      console.error("[mfa] factor load failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      setLoadError("Security settings could not be loaded. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (error) throw error;
      setEnrolling({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
    } catch (error) {
      console.error("[mfa] enrollment failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Authenticator setup could not start. Please try again.");
    }
    setBusy(false);
  }

  async function verify() {
    if (!enrolling) return;
    setBusy(true);
    try {
      const { data: chal, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: enrolling.factorId,
      });
      if (cErr) throw cErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: chal.id,
        code: code.trim(),
      });
      if (error) throw error;
      setEnrolling(null);
      setCode("");
      toast.success("Two-factor authentication enabled");
      load();
    } catch (error) {
      console.error("[mfa] enrollment verification failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("That code was not accepted. Check your authenticator and try again.");
    }
    setBusy(false);
  }

  async function unenroll(id: string) {
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      toast.success("Two-factor removed");
      load();
    } catch (error) {
      console.error("[mfa] factor removal failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("The authenticator could not be removed. Please try again.");
    }
    setBusy(false);
  }

  async function signOutOthers() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Signed out on other devices");
    } catch (error) {
      console.error("[mfa] remote session sign-out failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Other sessions could not be signed out. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <PasskeyPanel />
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Two-factor authentication</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Add an authenticator app (Google Authenticator, 1Password, Authy) for a second layer of
          security.
        </p>

        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
            <Button variant="outline" size="sm" onClick={load} className="mt-3">
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : factors.filter((f) => f.status === "verified").length > 0 ? (
          <div className="space-y-2">
            {factors
              .filter((f) => f.status === "verified")
              .map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2"
                >
                  <div className="text-sm">
                    <div className="font-medium">Authenticator app</div>
                    <div className="text-xs text-muted-foreground">
                      {f.friendly_name || "TOTP"} • Active
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unenroll(f.id)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                </div>
              ))}
          </div>
        ) : enrolling ? (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              <img
                src={enrolling.qr}
                alt="Scan this QR code with your authenticator app"
                className="w-32 h-32 rounded-md border border-border bg-white p-1"
              />
              <div className="text-xs text-muted-foreground space-y-2">
                <p>Scan the QR code, then enter the 6-digit code from your app.</p>
                <p>
                  Can't scan? Enter this secret manually:
                  <br />
                  <code className="text-[11px] break-all">{enrolling.secret}</code>
                </p>
              </div>
            </div>
            <Input
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="tracking-widest text-center"
            />
            <div className="flex gap-2">
              <Button onClick={verify} disabled={busy || code.length !== 6} className="flex-1">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & enable"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
                  setEnrolling(null);
                  setCode("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={startEnroll} disabled={busy} size="sm">
            <KeyRound className="w-4 h-4 mr-2" />
            Set up authenticator app
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <LogOut className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Active sessions</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Sign out of KovaGPT on every other device where your account is currently active.
        </p>
        <Button variant="outline" size="sm" onClick={signOutOthers} disabled={busy}>
          Sign out other sessions
        </Button>
      </div>
    </div>
  );
}
