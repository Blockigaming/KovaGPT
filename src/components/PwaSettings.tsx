import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  pushApi,
  setPwaOwner,
  pwaMessage,
  enableDevicePush,
  disableDevicePush,
  type PushDeviceBinding,
} from "@/lib/pwa/client";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import {
  canPromptInstall,
  noServerPrompt,
  subscribeInstallPrompt,
  promptPwaInstall,
} from "@/lib/pwa/install";
type Status = {
  ready: boolean;
  publicKey: string | null;
  preferenceRevision: number;
  quietHours: { start: string; end: string; timeZone: string } | null;
  devices: { id: string; revision: number; createdAt: string }[];
};
export function PwaSettings({ ownerId }: { ownerId: string | null }) {
  return <DeviceSettings key={ownerId ?? "signed-out"} ownerId={ownerId} />;
}
function DeviceSettings({ ownerId }: { ownerId: string | null }) {
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, noServerPrompt);
  const [status, setStatus] = useState<Status | null>(null),
    [binding, setBinding] = useState<PushDeviceBinding | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false),
    [start, setStart] = useState("22:00"),
    [end, setEnd] = useState("07:00");
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const load = useCallback(async () => {
    if (!ownerId || !supported) return;
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await setPwaOwner(ownerId);
      next.signal.throwIfAborted();
      const [value, local] = await Promise.all([
        pushApi(ownerId, next.signal),
        pwaMessage({ type: "BINDING", ownerId }, next.signal),
      ]);
      const state = value as unknown as Status;
      if (
        typeof state.ready !== "boolean" ||
        !Array.isArray(state.devices) ||
        state.devices.length > 5 ||
        !Number.isSafeInteger(state.preferenceRevision)
      )
        throw Error("invalid state");
      if (current !== generation.current) return;
      setStatus(state);
      setBinding((local.binding as PushDeviceBinding | null) ?? null);
      setQuiet(Boolean(state.quietHours));
      setStart(state.quietHours?.start ?? "22:00");
      setEnd(state.quietHours?.end ?? "07:00");
    } catch {
      if (current === generation.current) {
        setStatus(null);
        setBinding(null);
        setError("Notification settings could not be loaded.");
      }
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [ownerId, supported]);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    void load();
    const reset = (event: Event) => {
      if (ownerId && isPrincipalBrowserStorageClearedEvent(event, ownerId)) {
        invalidate();
        setBinding(null);
        setStatus(null);
      }
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      invalidate();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [load, invalidate, ownerId]);
  const act = async (
    action: "enable" | "disable" | "preferences" | "revoke",
    device?: { id: string; revision: number },
  ) => {
    if (!ownerId || busyRef.current || !status) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      if (action === "enable") {
        if (!status.publicKey) throw Error("Push is not enabled.");
        await enableDevicePush(ownerId, status.publicKey, next.signal);
      } else if (action === "disable") await disableDevicePush(ownerId, next.signal);
      else if (action === "preferences")
        await pushApi(ownerId, next.signal, {
          action: "preferences",
          expectedRevision: status.preferenceRevision,
          quietHours: quiet
            ? { start, end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
            : null,
        });
      else if (device)
        await pushApi(ownerId, next.signal, {
          action: "revoke",
          id: device.id,
          expectedRevision: device.revision,
        });
      if (current === generation.current) await load();
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error ? cause.message : "The notification change did not complete.",
        );
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-labelledby="pwa-settings-title"
    >
      <h4 id="pwa-settings-title" className="text-sm font-medium">
        Installed app and browser notifications
      </h4>
      <p className="text-xs text-muted-foreground">
        Use your browser’s Install app or Add to Home Screen command. Installation does not cache
        your private chats or documents.
      </p>
      {canInstall && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void promptPwaInstall().catch(() =>
              setError("The install prompt did not open. Use your browser’s install command."),
            )
          }
        >
          Install KovaGPT
        </Button>
      )}
      {!ownerId ? (
        <p className="text-sm">Sign in to manage browser notifications.</p>
      ) : !supported ? (
        <p className="text-sm">
          This browser does not offer Web Push here. On supported mobile browsers, install KovaGPT
          first.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          {!status?.ready && (
            <p className="text-sm">Browser notification delivery is not currently enabled.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Notifications show only that an update is ready. Open KovaGPT to read private content.
            Turning them off affects this browser; other devices have their own subscriptions.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !status?.ready || Boolean(binding)}
              onClick={() => void act("enable")}
            >
              Enable on this browser
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !binding}
              onClick={() => void act("disable")}
            >
              Turn off on this browser
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {binding && (
            <p className="text-sm" role="status">
              This browser is subscribed.
            </p>
          )}
          {status && (
            <div className="space-y-2 border-t pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={quiet}
                  disabled={busy}
                  onChange={(event) => setQuiet(event.target.checked)}
                />
                Quiet hours
              </label>
              {quiet && (
                <div className="flex flex-wrap gap-3 text-sm">
                  <label>
                    From{" "}
                    <input
                      aria-label="Quiet hours start"
                      type="time"
                      value={start}
                      disabled={busy}
                      onChange={(event) => setStart(event.target.value)}
                    />
                  </label>
                  <label>
                    Until{" "}
                    <input
                      aria-label="Quiet hours end"
                      type="time"
                      value={end}
                      disabled={busy}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </label>
                  <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act("preferences")}
              >
                Save quiet hours
              </Button>
            </div>
          )}
          {status?.devices
            .filter((device) => device.id !== binding?.id)
            .map((device) => (
              <div key={device.id} className="flex items-center justify-between gap-2 text-sm">
                <span>Another browser · {new Date(device.createdAt).toLocaleDateString()}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act("revoke", device)}
                >
                  Turn off
                </Button>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
