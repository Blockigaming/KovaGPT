import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useWorkStoreRevision } from "@/hooks/use-work-store-revision";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  getWorkSyncStatus,
  getServerWorkSyncStatus,
  retryWorkSync,
  startWorkSync,
  subscribeWorkSync,
  recordWorkRecent,
} from "@/lib/work-sync-client";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import { readWorkSyncState, visibleWorkRecords } from "@/lib/work-sync-state";

function previewWorkCopy(value: unknown): string {
  if (value === null || value === undefined) return "Removed";
  if (typeof value === "string")
    return value === "forget" ? "Remove from Recents" : `${value} recent work`;
  const record = value as Record<string, unknown>;
  const steps = Array.isArray(record.plan)
    ? record.plan
    : Array.isArray(record.steps)
      ? record.steps
      : [];
  return [
    record.name,
    record.objective,
    record.instructions,
    Array.isArray(record.context) ? record.context.join("\n") : record.context,
    ...steps.map((step) =>
      typeof step === "string" ? step : `${step.done ? "✓" : "○"} ${step.text}`,
    ),
    record.status ? `Status: ${String(record.status).replaceAll("_", " ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function WorkSyncRuntime() {
  const { isLoaded, user } = useUser();
  const ownerId = isLoaded ? user?.id : undefined;
  useEffect(() => {
    if (!ownerId) return;
    const stop = startWorkSync(ownerId);
    const clear = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, ownerId)) stop();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    return () => {
      stop();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    };
  }, [ownerId]);
  return null;
}

export function WorkSyncStatus() {
  const { isLoaded, user } = useUser();
  const status = useSyncExternalStore(
    subscribeWorkSync,
    getWorkSyncStatus,
    getServerWorkSyncStatus,
  );
  useWorkStoreRevision(user?.id ?? null);
  const [limit, setLimit] = useState(10);
  if (!isLoaded || !user || status.ownerId !== user.id) return null;
  let saved = null;
  try {
    saved = readWorkSyncState(localStorage, user.id);
  } catch {
    /* Preserve the recovery status. */
  }
  const records = saved
    ? (["task", "template", "agent_draft", "session"] as const).flatMap((kind) =>
        visibleWorkRecords(saved!, kind).map((record) => ({ kind, record })),
      )
    : [];
  const recents = Object.entries(saved?.recents ?? {})
    .filter(([, recent]) => !recent.deletedAt)
    .sort(
      ([, a], [, b]) =>
        Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) ||
        Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt),
    );
  const labels = {
    local: "Saved on this device",
    connecting: "Connecting saved work…",
    syncing: status.pending
      ? `${status.pending} saved-work change${status.pending === 1 ? "" : "s"} waiting to sync`
      : "Checking saved work…",
    saved: "Saved work is up to date",
    offline: "Offline — saved on this device",
    unavailable: "Saved-work sync unavailable",
    conflict: "Saved work needs your choice",
    "other-tab": "Saved-work sync is open in another tab",
  };
  return (
    <section className="my-3 rounded-xl border p-3 text-sm" aria-label="Saved work synchronization">
      <p role="status">{labels[status.phase]}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {status.message ??
          (status.phase === "other-tab"
            ? "Close the other tab to edit saved work here."
            : "Sync covers planning sessions, saved tasks, templates, agent drafts, and recent-work preferences.")}
      </p>
      {["unavailable", "offline", "conflict"].includes(status.phase) && (
        <button className="mt-2 min-h-10 rounded-lg border px-3 text-xs" onClick={retryWorkSync}>
          Retry sync
        </button>
      )}
      {records.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-10 cursor-pointer py-2">
            Saved sessions, tasks, templates, and drafts ({records.length})
          </summary>
          <ul className="space-y-2">
            {records.slice(0, limit).map(({ kind, record }) => (
              <li key={record.id} className="rounded-lg border p-2">
                <details
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      try {
                        recordWorkRecent(user.id, kind, record.id);
                      } catch {
                        /* Reading remains possible without the tab write lease. */
                      }
                    }
                  }}
                >
                  <summary className="min-h-10 cursor-pointer break-words py-2">
                    {String(record.name ?? record.objective)}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({kind.replace("_", " ")})
                    </span>
                  </summary>
                  <p className="whitespace-pre-wrap break-words">{String(record.objective)}</p>
                  {Boolean(record.context) && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {Array.isArray(record.context)
                        ? record.context.join("\n")
                        : String(record.context)}
                    </p>
                  )}
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                    {(Array.isArray(record.plan)
                      ? record.plan
                      : Array.isArray(record.steps)
                        ? record.steps
                        : []
                    ).map((step, index) => (
                      <li key={index}>{typeof step === "string" ? step : String(step.text)}</li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
          {records.length > limit && (
            <button
              className="mt-2 min-h-10 rounded-lg border px-3 text-xs"
              onClick={() => setLimit((value) => value + 20)}
            >
              Show more saved work
            </button>
          )}
        </details>
      )}
      {recents.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-10 cursor-pointer py-2">
            Recent saved work ({recents.length})
          </summary>
          <ul className="space-y-2">
            {recents.slice(0, limit).map(([key, recent]) => (
              <li key={key} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <span className="min-w-0 flex-1 break-words">
                  {saved?.records[recent.resourceId]?.title || "Work run"}
                </span>
                {([recent.pinnedAt ? "unpin" : "pin", "forget"] as const).map((operation) => (
                  <button
                    key={operation}
                    disabled={status.phase === "other-tab" || Boolean(saved?.pending[key])}
                    className="min-h-10 rounded-lg border px-3 text-xs capitalize disabled:opacity-50"
                    onClick={() => {
                      try {
                        recordWorkRecent(
                          user.id,
                          recent.resourceType,
                          recent.resourceId,
                          operation,
                        );
                      } catch {
                        toast.error("Recent work could not be updated. Retry sync first.");
                      }
                    }}
                  >
                    {operation}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          {recents.length > limit && (
            <button
              className="mt-2 min-h-10 rounded-lg border px-3 text-xs"
              onClick={() => setLimit((value) => value + 20)}
            >
              Show more recent work
            </button>
          )}
        </details>
      )}
      {status.conflicts.map((conflict) => (
        <div key={conflict.key} className="mt-3 border-t pt-3">
          <p className="break-words font-medium">{conflict.title}</p>
          <p className="text-xs text-muted-foreground">
            This device and your account changed the same item. Both copies are retained until you
            choose.
          </p>
          <details className="mt-2">
            <summary className="min-h-10 cursor-pointer py-2 text-xs">Compare copies</summary>
            <p className="font-medium">This device</p>
            <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {previewWorkCopy(saved?.pending[conflict.key]?.desired)}
            </p>
            <p className="mt-3 font-medium">Account</p>
            <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {conflict.key.startsWith("recent:")
                ? saved?.recents[conflict.key]?.deletedAt
                  ? "Removed from Recents"
                  : saved?.recents[conflict.key]?.pinnedAt
                    ? "Pinned"
                    : "Not pinned"
                : previewWorkCopy(
                    saved?.records[conflict.key]?.deletedAt
                      ? null
                      : saved?.records[conflict.key]?.payload,
                  )}
            </p>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            {(saved?.pending[conflict.key]?.kind === "session" &&
            typeof saved.pending[conflict.key].desired === "object" &&
            saved.pending[conflict.key].desired !== null
              ? ([
                  "new_session",
                  ...(saved.records[conflict.key] && !saved.records[conflict.key].deletedAt
                    ? ["device"]
                    : []),
                  "account",
                ] as const)
              : (["device", "account"] as const)
            ).map((choice) => (
              <button
                key={choice}
                className="min-h-10 rounded-lg border px-3 text-xs"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("kova:work-sync-resolve", {
                      detail: { ownerId: user.id, key: conflict.key, choice },
                    }),
                  )
                }
              >
                {choice === "new_session"
                  ? "Save current plan as a new session"
                  : choice === "device"
                    ? "Keep this device’s change"
                    : "Use the account copy"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
