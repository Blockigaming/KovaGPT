import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthProviders } from "@/hooks/useAuthProviders";
import { supabase } from "@/integrations/supabase/client";
import { browserSupportsPasskeys } from "@/lib/passkey-support";
import { toast } from "sonner";

type PasskeyRecord = {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
};

/**
 * WebAuthn passkey and hardware-security-key management. The deployment
 * capability probe keeps this surface hidden until Supabase Auth confirms
 * passkeys are enabled for the active project.
 */
export function PasskeyPanel() {
  const providers = useAuthProviders(true);
  const supported = browserSupportsPasskeys();
  const enabled = providers.resolved && providers.passkeys;
  const canLoad = enabled;
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const mutationInFlight = useRef(false);

  const beginMutation = (operation: string) => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setBusy(operation);
    return true;
  };

  const endMutation = () => {
    mutationInFlight.current = false;
    setBusy(null);
  };

  const load = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw error;
      setPasskeys(Array.isArray(data) ? (data as PasskeyRecord[]) : []);
    } catch (error) {
      console.error("[passkeys] list failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      setPasskeys([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [canLoad]);

  useEffect(() => {
    if (canLoad) void load();
  }, [canLoad, load]);

  if (!providers.resolved || !enabled) return null;

  async function register() {
    if (!supported || !beginMutation("register")) return;
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      toast.success("Passkey added");
      await load();
    } catch (error) {
      console.error("[passkeys] registration failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Passkey setup was cancelled or could not be completed.");
    } finally {
      endMutation();
    }
  }

  async function rename() {
    if (!editing) return;
    const friendlyName = editing.name.trim();
    if (!friendlyName || friendlyName.length > 120) {
      toast.error("Enter a name between 1 and 120 characters.");
      return;
    }
    if (!beginMutation(editing.id)) return;
    try {
      const { error } = await supabase.auth.passkey.update({
        passkeyId: editing.id,
        friendlyName,
      });
      if (error) throw error;
      setEditing(null);
      toast.success("Passkey renamed");
      await load();
    } catch (error) {
      console.error("[passkeys] rename failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("The passkey could not be renamed. Please try again.");
    } finally {
      endMutation();
    }
  }

  async function remove(id: string) {
    if (!beginMutation(id)) return;
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) throw error;
      setConfirmDelete(null);
      toast.success("Passkey removed");
      await load();
    } catch (error) {
      console.error("[passkeys] removal failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("The passkey could not be removed. Please try again.");
    } finally {
      endMutation();
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Passkeys and security keys</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Sign in with your device biometrics, PIN, password manager, or a compatible hardware
        security key.
      </p>

      {!supported ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This browser cannot add a passkey, but you can still review, rename, or remove registered
          passkeys.
        </p>
      ) : null}

      {loading ? (
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground"
          aria-label="Loading passkeys"
        />
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Passkeys could not be loaded. Please try again.</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="mt-3">
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {passkeys.length > 0 ? (
            <ul className="space-y-2" aria-label="Registered passkeys">
              {passkeys.map((passkey) => {
                const deleting = confirmDelete === passkey.id;
                const isEditing = editing?.id === passkey.id;
                const itemBusy = busy === passkey.id;
                const createdLabel = new Date(passkey.created_at).toLocaleDateString();
                const lastUsedLabel = passkey.last_used_at
                  ? new Date(passkey.last_used_at).toLocaleDateString()
                  : null;
                return (
                  <li key={passkey.id} className="rounded-lg border border-border/70 p-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label
                          className="text-xs font-medium"
                          htmlFor={`passkey-name-${passkey.id}`}
                        >
                          Passkey name
                        </label>
                        <Input
                          id={`passkey-name-${passkey.id}`}
                          value={editing.name}
                          maxLength={120}
                          autoFocus
                          onChange={(event) =>
                            setEditing({ id: passkey.id, name: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !busy) void rename();
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void rename()}
                            disabled={Boolean(busy) || !editing.name.trim()}
                          >
                            {itemBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(null)}
                            disabled={Boolean(busy)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {passkey.friendly_name || "Passkey"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Added {createdLabel}
                              {lastUsedLabel ? ` · Last used ${lastUsedLabel}` : ""}
                            </div>
                          </div>
                          {!deleting ? (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setEditing({
                                    id: passkey.id,
                                    name: passkey.friendly_name || "Passkey",
                                  })
                                }
                                disabled={Boolean(busy)}
                                aria-label={`Rename ${passkey.friendly_name || "passkey"}`}
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDelete(passkey.id)}
                                disabled={Boolean(busy)}
                                aria-label={`Remove ${passkey.friendly_name || "passkey"}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {deleting ? (
                          <div className="mt-3 rounded-lg bg-muted/50 p-3">
                            <p className="text-xs text-muted-foreground">
                              Remove this passkey? You will no longer be able to use it to sign in.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void remove(passkey.id)}
                                disabled={Boolean(busy)}
                              >
                                {itemBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDelete(null)}
                                disabled={Boolean(busy)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No passkeys are registered yet.</p>
          )}

          <Button size="sm" onClick={() => void register()} disabled={Boolean(busy) || !supported}>
            {busy === "register" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Add passkey
          </Button>
        </div>
      )}
    </div>
  );
}
