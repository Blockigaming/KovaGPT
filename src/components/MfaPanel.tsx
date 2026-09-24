import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, KeyRound, LogOut, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PasskeyPanel } from "@/components/PasskeyPanel";
import { KovaPasswordPanel } from "@/components/KovaPasswordPanel";
import { KovaPasskeyPanel } from "@/components/KovaPasskeyPanel";
import {
  browserKovaAuthMode,
  clearKovaAuthCache,
  isKovaSessionActive,
  kovaAuthJson,
} from "@/lib/kova-auth-browser";

type Factor = {
  id: string;
  friendly_name?: string | null;
  status: string;
  recoveryCodesRemaining?: number;
};

function verifiedRecoveryCodes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length !== 8 ||
    !value.every((item) => typeof item === "string" && /^[A-Za-z0-9_-]{43,128}$/u.test(item)) ||
    new Set(value).size !== 8
  ) {
    throw new Error("invalid_recovery_codes_response");
  }
  return value;
}

/** Owned MFA and device controls, with the legacy provider retained only in legacy mode. */
export function MfaPanel() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<null | {
    factorId: string;
    qr: string;
    secret: string;
    uri: string;
    legacyMigration?: boolean;
  }>(null);
  const [code, setCode] = useState("");
  const [enrollmentPassword, setEnrollmentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [confirmRegeneration, setConfirmRegeneration] = useState(false);
  const [legacyPasswordRequired, setLegacyPasswordRequired] = useState(false);
  const [legacyMigrationCompleted, setLegacyMigrationCompleted] = useState(false);
  const [legacyOwnerId, setLegacyOwnerId] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const useKovaAuth = isKovaSessionActive();
  let legacyMigrationAvailable = false;
  if (!useKovaAuth) {
    try {
      legacyMigrationAvailable = browserKovaAuthMode() === "dual";
    } catch {
      legacyMigrationAvailable = false;
    }
  }

  const beginMutation = () => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setBusy(true);
    return true;
  };
  const endMutation = () => {
    mutationInFlight.current = false;
    setBusy(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (useKovaAuth) {
        setLegacyOwnerId(null);
        const response = await fetch("/api/auth/mfa/factors", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("kova_mfa_factors");
        const payload = (await response.json()) as {
          factors?: Array<{
            id: string;
            friendlyName: string | null;
            recoveryCodesRemaining: number;
          }>;
        };
        if (
          !Array.isArray(payload.factors) ||
          payload.factors.some(
            (factor) =>
              !Number.isSafeInteger(factor.recoveryCodesRemaining) ||
              factor.recoveryCodesRemaining < 0 ||
              factor.recoveryCodesRemaining > 8,
          )
        ) {
          throw new Error("kova_mfa_factors_invalid");
        }
        setFactors(
          payload.factors.map((factor) => ({
            id: factor.id,
            friendly_name: factor.friendlyName,
            status: "verified",
            recoveryCodesRemaining: factor.recoveryCodesRemaining,
          })),
        );
      } else {
        const [
          { data: factorData, error: factorError },
          { data: sessionData, error: sessionError },
        ] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.getSession()]);
        if (factorError || sessionError || !sessionData.session?.user?.id) {
          throw factorError ?? sessionError ?? new Error("legacy_session_unavailable");
        }
        setLegacyOwnerId(sessionData.session.user.id);
        setFactors([...(factorData?.totp ?? [])] as Factor[]);
      }
    } catch (error) {
      setFactors([]);
      console.error("[mfa] factor load failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      setLoadError("Security settings could not be loaded. Please try again.");
    }
    setLoading(false);
  }, [useKovaAuth]);

  useEffect(() => {
    load();
  }, [load]);

  async function startEnroll() {
    if (!beginMutation()) return;
    setRecoveryCodes([]);
    try {
      if (useKovaAuth) {
        const response = await kovaAuthJson("/api/auth/mfa/enroll", {
          ...(enrollmentPassword ? { currentPassword: enrollmentPassword } : {}),
        });
        const data = (await response.json()) as {
          factorId?: string;
          secret?: string;
          uri?: string;
        };
        if (response.status === 403) {
          toast.error(
            "Confirm your password, or sign in again with Google or a passkey, then retry authenticator setup.",
          );
          return;
        }
        if (!response.ok || !data.factorId || !data.secret || !data.uri) throw new Error("enroll");
        setEnrolling({ factorId: data.factorId, qr: "", secret: data.secret, uri: data.uri });
      } else {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
        if (error) throw error;
        setEnrolling({
          factorId: data.id,
          qr: data.totp.qr_code,
          secret: data.totp.secret,
          uri: data.totp.uri,
        });
      }
    } catch (error) {
      console.error("[mfa] enrollment failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Authenticator setup could not start. Please try again.");
    } finally {
      setEnrollmentPassword("");
      endMutation();
    }
  }

  async function legacyMfaRequest(
    path: "/api/auth/mfa/enroll" | "/api/auth/mfa/verify",
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (!legacyOwnerId) throw new Error("legacy_mfa_owner_unavailable");
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) throw error ?? new Error("legacy_session_unavailable");
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Kova-Owner": legacyOwnerId,
      },
      body: JSON.stringify(body),
    });
  }

  async function startLegacyMigration() {
    if (!legacyMigrationAvailable || !beginMutation()) return;
    setRecoveryCodes([]);
    try {
      const response = await legacyMfaRequest("/api/auth/mfa/enroll", {
        legacyMigration: true,
        friendlyName: "Authenticator app",
        ...(legacyPasswordRequired && enrollmentPassword
          ? { newPassword: enrollmentPassword }
          : {}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        factorId?: string;
        secret?: string;
        uri?: string;
      };
      if (response.status === 409 && payload.code === "kova_password_required") {
        setLegacyPasswordRequired(true);
        toast.error("Choose a new KovaGPT password, then continue the MFA migration.");
        return;
      }
      if (!response.ok || !payload.factorId || !payload.secret || !payload.uri) {
        if (response.status === 403) {
          toast.error("Verify your existing authenticator first, then retry the migration.");
          return;
        }
        throw new Error("legacy_mfa_migration_start");
      }
      setEnrolling({
        factorId: payload.factorId,
        qr: "",
        secret: payload.secret,
        uri: payload.uri,
        legacyMigration: true,
      });
      setFactors([]);
      setLegacyPasswordRequired(false);
      setEnrollmentPassword("");
    } catch (error) {
      console.error("[mfa] legacy migration start failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Two-factor migration could not start. Please try again.");
    } finally {
      endMutation();
    }
  }

  async function verify() {
    if (!enrolling || !beginMutation()) return;
    try {
      if (enrolling.legacyMigration) {
        const response = await legacyMfaRequest("/api/auth/mfa/verify", {
          legacyMigration: true,
          factorId: enrolling.factorId,
          code: code.trim(),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          recoveryCodes?: unknown;
        };
        if (!response.ok) throw new Error("legacy_mfa_migration_verify");
        setRecoveryCodes(verifiedRecoveryCodes(payload.recoveryCodes));
        setLegacyMigrationCompleted(true);
        setFactors([]);
        clearKovaAuthCache();
      } else if (useKovaAuth) {
        const response = await kovaAuthJson("/api/auth/mfa/verify", {
          factorId: enrolling.factorId,
          code: code.trim(),
        });
        const payload = (await response.json()) as { recoveryCodes?: unknown };
        if (!response.ok) throw new Error("verify");
        setRecoveryCodes(verifiedRecoveryCodes(payload.recoveryCodes));
        clearKovaAuthCache();
      } else {
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
      }
      const migrated = enrolling.legacyMigration === true;
      setEnrolling(null);
      setCode("");
      toast.success(
        migrated
          ? "Two-factor authentication moved to KovaGPT"
          : "Two-factor authentication enabled",
      );
      if (!migrated) void load();
    } catch (error) {
      console.error("[mfa] enrollment verification failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("That code was not accepted. Check your authenticator and try again.");
    } finally {
      endMutation();
    }
  }

  async function unenroll(id: string) {
    if (!beginMutation()) return;
    try {
      if (useKovaAuth) {
        const response = await kovaAuthJson("/api/auth/mfa/remove", { factorId: id });
        if (!response.ok) throw new Error("remove");
      } else {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
        if (error) throw error;
      }
      setRecoveryCodes([]);
      setConfirmRegeneration(false);
      if (useKovaAuth) clearKovaAuthCache();
      toast.success("Two-factor removed");
      load();
    } catch (error) {
      console.error("[mfa] factor removal failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("The authenticator could not be removed. Please try again.");
    } finally {
      endMutation();
    }
  }

  async function signOutOthers() {
    if (!beginMutation()) return;
    try {
      if (useKovaAuth) {
        const response = await kovaAuthJson("/api/auth/sessions/revoke-others", {});
        const payload = (await response.json()) as { revokedCount?: unknown };
        if (
          !response.ok ||
          typeof payload.revokedCount !== "number" ||
          !Number.isSafeInteger(payload.revokedCount) ||
          payload.revokedCount < 0
        ) {
          throw new Error("kova_other_sessions_failed");
        }
        clearKovaAuthCache();
      } else {
        const { error } = await supabase.auth.signOut({ scope: "others" });
        if (error) throw error;
      }
      toast.success("Signed out on other devices");
    } catch (error) {
      console.error("[mfa] remote session sign-out failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Other sessions could not be signed out. Please try again.");
    } finally {
      endMutation();
    }
  }

  async function regenerateRecoveryCodes() {
    if (!useKovaAuth || !confirmRegeneration || !beginMutation()) return;
    setRecoveryCodes([]);
    try {
      const response = await kovaAuthJson("/api/auth/mfa/recovery/regenerate", { confirm: true });
      const payload = (await response.json()) as { recoveryCodes?: unknown };
      if (!response.ok) throw new Error("kova_recovery_regeneration_failed");
      setRecoveryCodes(verifiedRecoveryCodes(payload.recoveryCodes));
      clearKovaAuthCache();
      setConfirmRegeneration(false);
      toast.success("Recovery codes replaced. Save the new codes now.");
      void load();
    } catch {
      clearKovaAuthCache();
      toast.error("Could not confirm new recovery codes. Sign in again before trying again.");
    } finally {
      endMutation();
    }
  }

  return (
    <div className="space-y-4">
      {!useKovaAuth ? <PasskeyPanel /> : null}
      {useKovaAuth ? <KovaPasskeyPanel /> : null}
      {useKovaAuth ? <KovaPasswordPanel /> : null}
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
            {legacyMigrationAvailable ? (
              <div className="rounded-lg border border-border/70 p-3">
                <p className="text-sm font-medium">Move two-factor authentication to KovaGPT</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Verify your existing authenticator, then enroll a fresh Kova-owned authenticator.
                  Hosted session authority is retired only after the new factor succeeds.
                </p>
                {legacyPasswordRequired ? (
                  <div className="mt-3 space-y-2">
                    <label htmlFor="legacy-mfa-new-password" className="text-xs font-medium">
                      New KovaGPT password
                    </label>
                    <Input
                      id="legacy-mfa-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={enrollmentPassword}
                      onChange={(event) => setEnrollmentPassword(event.target.value)}
                      disabled={busy}
                    />
                  </div>
                ) : null}
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={startLegacyMigration}
                  disabled={busy}
                >
                  Move MFA to KovaGPT
                </Button>
              </div>
            ) : null}
          </div>
        ) : enrolling ? (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              {enrolling.qr ? (
                <img
                  src={enrolling.qr}
                  alt="Scan this QR code with your authenticator app"
                  className="w-32 h-32 rounded-md border border-border bg-white p-1"
                />
              ) : null}
              <div className="text-xs text-muted-foreground space-y-2">
                <p>Scan the QR code, then enter the 6-digit code from your app.</p>
                <p>
                  Can't scan? Enter this secret manually:
                  <br />
                  <code className="text-[11px] break-all">{enrolling.secret}</code>
                </p>
                {useKovaAuth || enrolling.legacyMigration ? (
                  <a href={enrolling.uri} className="text-primary underline">
                    Open in authenticator app
                  </a>
                ) : null}
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
                  if (!useKovaAuth && !enrolling.legacyMigration) {
                    supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
                  }
                  const wasMigration = enrolling.legacyMigration === true;
                  setEnrolling(null);
                  setCode("");
                  if (wasMigration) void load();
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {useKovaAuth ? (
              <div className="space-y-2">
                <label htmlFor="mfa-enrollment-password" className="text-sm font-medium">
                  Current password
                </label>
                <Input
                  id="mfa-enrollment-password"
                  type="password"
                  autoComplete="current-password"
                  value={enrollmentPassword}
                  onChange={(event) => setEnrollmentPassword(event.target.value)}
                  disabled={busy}
                  aria-describedby="mfa-enrollment-reauth-help"
                />
                <p id="mfa-enrollment-reauth-help" className="text-xs text-muted-foreground">
                  Confirm your password before adding an authenticator. For Google or passkey
                  accounts, sign in again with that method and return here within five minutes; no
                  password is needed.
                </p>
              </div>
            ) : null}
            <Button onClick={startEnroll} disabled={busy} size="sm">
              <KeyRound className="w-4 h-4 mr-2" />
              Set up authenticator app
            </Button>
          </div>
        )}
      </div>

      {useKovaAuth &&
      !loading &&
      !loadError &&
      factors.some((factor) => factor.status === "verified") ? (
        <div className="rounded-2xl border border-border bg-card/60 p-5">
          <h3 className="text-sm font-semibold">Recovery codes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {factors[0]?.recoveryCodesRemaining} unused recovery codes remain.
          </p>
          {confirmRegeneration ? (
            <div className="mt-3 space-y-3" role="group" aria-label="Replace recovery codes">
              <p className="text-sm text-muted-foreground">
                All existing recovery codes will stop working. Other devices will be signed out.
                Save the new codes before leaving this page.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={regenerateRecoveryCodes} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Replace recovery codes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmRegeneration(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy || recoveryCodes.length > 0}
              onClick={() => setConfirmRegeneration(true)}
            >
              Generate new recovery codes
            </Button>
          )}
        </div>
      ) : null}

      {recoveryCodes.length > 0 ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5" role="status">
          <h3 className="text-sm font-semibold">Save your recovery codes now</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Each code works once. They will not be shown again.
          </p>
          <ul className="mt-3 grid gap-1 font-mono text-xs sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode} className="min-w-0 break-all">
                {recoveryCode}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setRecoveryCodes([]);
              if (legacyMigrationCompleted) window.location.reload();
            }}
          >
            I saved these codes
          </Button>
        </div>
      ) : null}

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
