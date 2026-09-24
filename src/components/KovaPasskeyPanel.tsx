import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserSupportsPasskeys } from "@/lib/passkey-support";
import {
  registerKovaPasskey,
  renameKovaPasskey,
  removeKovaPasskey,
} from "@/lib/kova-auth-passkey-browser";
import { toast } from "sonner";
import { useUser } from "@/components/auth/ClerkSafe";
import { getCapturedKovaPrincipal, type KovaBrowserPrincipal } from "@/lib/kova-auth-browser";

type Passkey = { id: string; friendlyName: string; createdAt: string; lastUsedAt: string | null };
type Status = {
  passkeys: Passkey[];
  requiresPassword: boolean;
  canRegister: boolean;
  canRemove: boolean;
  principal: Pick<KovaBrowserPrincipal, "accountId" | "sessionId">;
};
export function KovaPasskeyPanel() {
  const displayedAccount = useUser().user?.id;
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const supported = browserSupportsPasskeys();

  useEffect(() => {
    let active = true;
    setStatus(null);
    setFailed(false);
    void (async () => {
      try {
        const principal = getCapturedKovaPrincipal();
        if (!principal || principal.accountId !== displayedAccount)
          throw new Error("kova_passkey_principal_changed");
        const response = await fetch("/api/auth/passkeys", {
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "X-Kova-Owner": principal.accountId,
            "X-Kova-Session": principal.sessionId,
          },
        });
        const data = (await response.json()) as Status;
        if (
          !response.ok ||
          !Array.isArray(data.passkeys) ||
          data.passkeys.length > 10 ||
          typeof data.requiresPassword !== "boolean" ||
          typeof data.canRegister !== "boolean" ||
          typeof data.canRemove !== "boolean" ||
          data.passkeys.some(
            (key) =>
              !key ||
              typeof key.id !== "string" ||
              typeof key.friendlyName !== "string" ||
              typeof key.createdAt !== "string" ||
              (key.lastUsedAt !== null && typeof key.lastUsedAt !== "string"),
          )
        )
          throw new Error("invalid_passkey_status");
        if (active) setStatus({ ...data, principal });
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [revision, displayedAccount]);

  function clear() {
    setEditing(null);
    setRemoving(null);
    setPassword("");
    setName("");
  }
  async function mutate(operation: () => Promise<void>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await operation();
      clear();
      toast.success(message);
    } catch {
      toast.error(
        "The passkey change was cancelled or could not be confirmed. Sign in again before retrying.",
      );
    } finally {
      setPassword("");
      inFlight.current = false;
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!status || !editing || inFlight.current) return;
    const friendlyName = name.trim();
    if (!friendlyName || friendlyName.length > 120 || /[\uD800-\uDFFF]/u.test(friendlyName)) return;
    if (editing === "register") {
      if (!supported || !status.canRegister || (status.requiresPassword && !password)) return;
      await mutate(
        () =>
          registerKovaPasskey(
            {
              friendlyName,
              ...(status.requiresPassword ? { currentPassword: password } : {}),
            },
            status.principal,
          ),
        "Passkey added. Other devices were signed out.",
      );
    } else
      await mutate(
        () => renameKovaPasskey(editing, friendlyName, status.principal),
        "Passkey renamed",
      );
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card/60 p-5"
      aria-labelledby="kova-passkeys-heading"
    >
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id="kova-passkeys-heading" className="text-sm font-semibold">
          Passkeys and security keys
        </h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Sign in with your device biometrics, PIN, or a compatible security key.
      </p>
      {failed ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Passkey settings could not be loaded.</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : !status ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading passkeys" />
      ) : (
        <div className="space-y-3">
          {!supported ? (
            <p className="text-xs text-muted-foreground">
              This browser cannot add a passkey. You can still manage existing passkeys.
            </p>
          ) : null}
          {status.passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No passkeys are registered yet.</p>
          ) : (
            <ul aria-label="Registered Kova passkeys" className="space-y-2">
              {status.passkeys.map((key) => (
                <li key={key.id} className="rounded-lg border border-border/70 p-3">
                  <div className="break-words text-sm font-medium">{key.friendlyName}</div>
                  <div className="text-xs text-muted-foreground">
                    Added {new Date(key.createdAt).toLocaleDateString()}
                  </div>
                  {removing === key.id ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Remove this passkey? Keep another sign-in method. Other devices will be
                        signed out.
                      </p>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy || !status.canRemove}
                        onClick={() =>
                          mutate(
                            () => removeKovaPasskey(key.id, status.principal),
                            "Passkey removed. Other devices were signed out.",
                          )
                        }
                      >
                        Confirm removal
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || editing !== null || removing !== null}
                        aria-label={`Rename ${key.friendlyName}`}
                        onClick={() => {
                          clear();
                          setName(key.friendlyName);
                          setEditing(key.id);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          busy || editing !== null || removing !== null || !status.canRemove
                        }
                        aria-label={`Remove ${key.friendlyName}`}
                        onClick={() => {
                          clear();
                          setRemoving(key.id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!status.canRemove && status.passkeys.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Sign in with a passkey or two-factor authentication to remove a key.
            </p>
          ) : null}
          {editing ? (
            <form onSubmit={submit} className="space-y-3">
              <Label htmlFor="kova-passkey-name">Passkey name</Label>
              <Input
                id="kova-passkey-name"
                value={name}
                maxLength={120}
                disabled={busy}
                required
                onChange={(event) => setName(event.target.value)}
              />
              {editing === "register" && status.requiresPassword ? (
                <>
                  <Label htmlFor="kova-passkey-password">Current password</Label>
                  <Input
                    id="kova-passkey-password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={1024}
                    value={password}
                    disabled={busy}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </>
              ) : null}
              {editing === "register" ? (
                <p className="text-xs text-muted-foreground">
                  Your device will ask you to verify. Adding a key signs out other devices.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    !name.trim() ||
                    (editing === "register" && status.requiresPassword && !password)
                  }
                >
                  {busy ? "Verifying…" : editing === "register" ? "Create passkey" : "Save name"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clear}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : removing === null && status.canRegister && status.passkeys.length < 10 ? (
            <Button
              size="sm"
              disabled={busy || !supported}
              onClick={() => {
                clear();
                setName("Passkey");
                setEditing("register");
              }}
            >
              Add passkey
            </Button>
          ) : null}
          {!status.canRegister ? (
            <p className="text-xs text-muted-foreground">
              Confirm your password or sign in with two-factor authentication before adding a
              passkey.
            </p>
          ) : null}
          {status.passkeys.length >= 10 ? (
            <p className="text-xs text-muted-foreground">
              You have reached the limit of ten passkeys.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
