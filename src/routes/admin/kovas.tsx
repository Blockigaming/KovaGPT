import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { requestKovas } from "@/lib/custom-kovas-client";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
} from "@/lib/principal-browser-storage.mjs";
export const Route = createFileRoute("/admin/kovas")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Kova moderation | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
type Report = {
  id: string;
  kova_id: string;
  reason: string;
  created_at: string;
  version_id: string;
  name: string;
  revision: number;
  blocked: boolean;
  config?: { instructions: string };
  knowledge?: { title: string; content: string }[];
};
function Page() {
  const { isLoaded, user } = useUser();
  return (
    <AppShell>
      {isLoaded ? (
        user ? (
          <Queue key={user.id} owner={user.id} />
        ) : (
          <SignInButton mode="modal">
            <button>Sign in to moderation</button>
          </SignInButton>
        )
      ) : (
        <p>Loading account…</p>
      )}
    </AppShell>
  );
}
function Queue({ owner }: { owner: string }) {
  const [rows, setRows] = useState<Report[]>([]),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(true),
    [epoch, setEpoch] = useState(0),
    [closed, setClosed] = useState(false),
    [lookup, setLookup] = useState("");
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;

    const reset = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, owner)) {
        controller.abort();
        setRows([]);
        setReason("");
        setClosed(true);
      }
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      controller.abort();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [owner]);
  useEffect(() => {
    const controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, lifetime.current.signal]);
    setBusy(true);
    setError("");
    void requestKovas<{ rows: Report[] }>(owner, "/api/admin/kovas", signal)
      .then((v) => {
        if (!signal.aborted) setRows(v.rows);
      })
      .catch((e) => {
        if (!signal.aborted) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Moderation unavailable.");
        }
      })
      .finally(() => {
        if (!signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [owner, epoch]);
  async function act(
    id: string,
    revision: number,
    action: "block" | "restore" | "review",
    reportId?: string,
  ) {
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await requestKovas(owner, "/api/admin/kovas", lifetime.current.signal, {
        id,
        revision,
        action,
        reason: reason.trim(),
        ...(reportId ? { reportId } : {}),
      });
      if (lifetime.current.signal.aborted) return;
      setRows([]);
      setReason("");
      setEpoch((v) => v + 1);
    } catch (e) {
      if (!lifetime.current.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : "Request outcome is uncertain. Refresh before another action.",
        );
        setRows([]);
        setBusy(false);
      }
    }
  }
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const v = await requestKovas<Report>(
        owner,
        `/api/admin/kovas?id=${encodeURIComponent(lookup)}`,
        lifetime.current.signal,
      );
      if (!lifetime.current.signal.aborted) setRows([v]);
    } catch (e) {
      if (!lifetime.current.signal.aborted)
        setError(e instanceof Error ? e.message : "Kova unavailable.");
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }
  if (closed) return <p>Device data was cleared. Reload to reopen moderation.</p>;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">Kova moderation</h1>
      <p className="text-sm text-muted-foreground">
        Access requires an operator-configured administrator account. Review the oldest open
        reports; processing them advances this queue. Blocking revokes chat, previews, and link
        grants. Restoring does not restore old link grants.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="underline" disabled={busy} onClick={() => setEpoch((v) => v + 1)}>
          Refresh reports
        </button>
        <label className="text-sm">
          Kova ID
          <input
            className="ml-2 rounded border bg-background p-2"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            maxLength={36}
          />
        </label>
        <button
          className="underline"
          disabled={busy || lookup.length !== 36}
          onClick={() => void inspect()}
        >
          Inspect moderation state
        </button>
      </div>
      <label className="block text-sm">
        Decision reason
        <textarea
          className="w-full rounded border bg-background p-2"
          maxLength={2000}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {busy && <p role="status">Loading moderation state…</p>}
      {!busy && !rows.length && !error && <p>No open reports.</p>}
      {rows.map((row) => (
        <article key={row.id ?? row.kova_id} className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">{row.name}</h2>
          <p className="text-sm">{row.reason ?? "No open report selected."}</p>
          <p className="text-xs text-muted-foreground">
            {row.kova_id} · {row.blocked ? "Blocked" : "Available"} · revision {row.revision}
          </p>
          <details>
            <summary>Published snapshot</summary>
            {row.config ? (
              <>
                <pre className="whitespace-pre-wrap text-sm">{row.config.instructions}</pre>
                {row.knowledge?.map((k, i) => (
                  <div key={i}>
                    <h3>{k.title}</h3>
                    <pre className="whitespace-pre-wrap text-sm">{k.content}</pre>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm">
                Use the Kova ID lookup to inspect its current published snapshot. Private drafts are
                excluded.
              </p>
            )}
          </details>
          <div className="flex flex-wrap gap-3">
            <button
              className="underline"
              disabled={busy || !reason.trim() || row.blocked}
              onClick={() => void act(row.kova_id, row.revision, "block")}
            >
              Block Kova
            </button>
            <button
              className="underline"
              disabled={busy || !reason.trim() || !row.blocked}
              onClick={() => void act(row.kova_id, row.revision, "restore")}
            >
              Restore access
            </button>
            <button
              className="underline"
              disabled={busy || !reason.trim() || !row.id}
              onClick={() => void act(row.kova_id, row.revision, "review", row.id)}
            >
              Mark this report reviewed
            </button>
            <Link
              className="underline"
              to={"/kovas" as never}
              search={{ id: row.kova_id } as never}
            >
              Open Kova
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
