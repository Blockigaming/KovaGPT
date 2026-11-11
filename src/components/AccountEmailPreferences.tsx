import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ACCOUNT_EMAIL_EVENTS } from "@/lib/account-email-preferences.mjs";
import {
  requestAccountEmailPreferences,
  type AccountEmailEvent,
  type AccountEmailPreferences as Preferences,
} from "@/lib/account-email-preferences-client";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

export function AccountEmailPreferences({ ownerId }: { ownerId: string | null }) {
  return <AccountEmailControls key={ownerId ?? "signed-out"} ownerId={ownerId} />;
}

function AccountEmailControls({ ownerId }: { ownerId: string | null }) {
  const sectionId = useId();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    busyRef.current = false;
  }, []);

  const load = useCallback(async () => {
    if (!ownerId || busyRef.current) return;
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    setPreferences(null);
    try {
      const value = await requestAccountEmailPreferences(ownerId, next.signal);
      if (current === generation.current) setPreferences(value);
    } catch {
      if (current === generation.current)
        setError("Email settings could not be loaded. Reload to try again.");
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [ownerId]);

  useEffect(() => {
    void load();
    const reset = (event: Event) => {
      if (ownerId && isPrincipalBrowserStorageClearedEvent(event, ownerId)) {
        invalidate();
        setPreferences(null);
        setBusy(false);
        setSaved(null);
        setError("Your account changed. Reload email settings.");
      }
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      invalidate();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [invalidate, load, ownerId]);

  const change = async (event: AccountEmailEvent, enabled: boolean) => {
    if (!ownerId || !preferences || busyRef.current) return;
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const value = await requestAccountEmailPreferences(ownerId, next.signal, {
        [event]: enabled,
      });
      if (current === generation.current) {
        setPreferences(value);
        setSaved("Email preference saved.");
      }
    } catch {
      if (current === generation.current) {
        // An interrupted response may follow a successful commit. Require an
        // explicit read before another write instead of guessing or retrying.
        setPreferences(null);
        setError("The change could not be confirmed. Reload to check your email preferences.");
      }
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border p-4" aria-labelledby={sectionId}>
      <div className="space-y-1">
        <h4 id={sectionId} className="text-sm font-medium">
          Account emails
        </h4>
        <p className="text-xs leading-5 text-muted-foreground">
          Choose which account updates arrive by email. Changes apply to your account on all
          devices.
        </p>
      </div>
      {!ownerId ? (
        <p className="text-sm">Sign in to manage account emails.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-xs text-muted-foreground">
              {preferences ? "Saving email preference…" : "Loading email preferences…"}
            </p>
          )}
          {saved && (
            <p role="status" className="text-xs text-muted-foreground">
              {saved}
            </p>
          )}
          {preferences && (
            <div className="divide-y divide-border">
              {ACCOUNT_EMAIL_EVENTS.map(({ key, label, description }) => {
                const id = `${sectionId}-${key}`;
                return (
                  <div key={key} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-1">
                      <label htmlFor={id} className="text-sm font-medium">
                        {label}
                      </label>
                      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <Switch
                      id={id}
                      checked={preferences[key]}
                      disabled={busy}
                      aria-describedby={`${id}-hint`}
                      onCheckedChange={(value) => void change(key, value)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void load()}
          >
            Reload email preferences
          </Button>
        </>
      )}
      <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        Verification and password-reset emails you request are still sent when needed to complete
        those actions.
      </p>
    </section>
  );
}
