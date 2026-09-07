import { useEffect, useRef, useState } from "react";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";
import type { BrowserResult } from "@/lib/work-browser-transport.mjs";
import { requestWorkSync } from "@/lib/work-sync-client";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";
type Session = { id: string; sequence: number; mode: string; expires_at: string };
type Snapshot = {
  readiness: { available: boolean; origins: string[] };
  runRevision: number;
  runStatus: string;
  sessions: Session[];
};
export function WorkBrowserPanel({ ownerId, run }: { ownerId: string; run: WorkRun }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [view, setView] = useState<BrowserResult | null>(null),
    [url, setUrl] = useState(""),
    [target, setTarget] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [cleared, setCleared] = useState(false);
  const lifetime = useRef<AbortController | null>(null),
    serial = useRef(0),
    busyRef = useRef(false);
  async function refresh() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    const captured = ++serial.current;
    try {
      const value = (await requestWorkSync(
        ownerId,
        `/api/work/browser?expectedUserId=${encodeURIComponent(ownerId)}&runId=${encodeURIComponent(run.id)}`,
        signal,
      )) as Snapshot;
      if (signal.aborted || captured !== serial.current) return;
      if (!Array.isArray(value.sessions) || !Array.isArray(value.readiness?.origins))
        throw Error("invalid");
      setSnapshot(value);
      setView((old) =>
        old &&
        value.sessions.some((item) => item.id === old.sessionId && item.sequence === old.sequence)
          ? old
          : null,
      );
    } catch {
      if (!signal.aborted && captured === serial.current)
        setError("Browser status could not be confirmed. Refresh before another action.");
    }
  }
  useEffect(() => {
    const active = createWorkViewLifetime(ownerId, () => {
      serial.current++;
      setCleared(true);
      setSnapshot(null);
      setView(null);
      setUrl("");
      setTarget("");
      setText("");
      setError(null);
    });
    lifetime.current = active.controller;
    void refresh();
    return () => {
      active.dispose();
    };
    // This component is keyed by owner/run. Revision changes are checked by the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, run.id]);
  const session = snapshot?.sessions[0],
    paused = run.status === "paused" && !run.step && run.effect?.status !== "started";
  async function command(operation: string, extra: Record<string, unknown> = {}) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const body = {
      expectedUserId: ownerId,
      runId: run.id,
      sessionId: session?.id ?? crypto.randomUUID(),
      expectedRevision: run.revision,
      expectedSequence: session?.sequence ?? 0,
      operation,
      ...extra,
    };
    // Passwords and page text remain ephemeral; failed actions never leave a retry payload.
    setText("");
    setTarget("");
    setView(null);
    const captured = ++serial.current;
    try {
      const response = (await requestWorkSync(ownerId, "/api/work/browser", signal, body)) as {
        result: BrowserResult;
        expiresAt: number;
      };
      if (signal.aborted || captured !== serial.current) return;
      if (response.result?.runId !== run.id || response.result.sessionId !== body.sessionId)
        throw Error("invalid");
      setView(response.result);
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              sessions: response.result.closed
                ? []
                : [
                    {
                      id: body.sessionId,
                      sequence: response.result.sequence,
                      mode: response.result.mode ?? "takeover",
                      expires_at: new Date(response.expiresAt).toISOString(),
                    },
                  ],
            }
          : previous,
      );
    } catch {
      if (!signal.aborted && captured === serial.current)
        setError(
          "The action is not confirmed. Refresh status; do not repeat a submitted form or purchase until you check its result.",
        );
    } finally {
      busyRef.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  if (cleared)
    return (
      <p className="text-sm text-muted-foreground">
        Private browser controls were cleared from this view.
      </p>
    );
  if (!snapshot?.readiness.available && !session)
    return (
      <p className="text-sm text-muted-foreground">Private browser execution is unavailable.</p>
    );
  const disabled = busy || !paused;
  return (
    <section aria-label="Private Work browser" className="mt-4 space-y-3 rounded-xl border p-3">
      <h4 className="font-medium">Private browser</h4>
      <p className="text-sm text-muted-foreground">
        Pause Work before taking control. The model cannot read or act during takeover. Sessions
        close after five minutes; sign-in data is not saved to Work history.
      </p>
      <p className="break-words text-xs">
        Reviewed sites: {snapshot?.readiness.origins.join(", ")}
      </p>
      {!paused && (
        <p role="status" className="text-sm">
          Pause this run and wait for its current step to settle.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError(null);
          void refresh();
        }}
        className="text-sm underline"
      >
        Refresh browser status
      </button>
      {!session && (
        <div className="flex flex-wrap gap-2">
          <label className="flex-1 text-sm">
            Reviewed website URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
              className="block w-full rounded border bg-background p-2"
            />
          </label>
          <button
            type="button"
            disabled={disabled || !url}
            onClick={() => void command("open", { url })}
            className="rounded border px-3 py-2"
          >
            Open and take control
          </button>
        </div>
      )}
      {session && (
        <>
          <p className="text-sm" role="status">
            {session.mode === "takeover"
              ? "You have control."
              : "Work can request approved browser actions."}{" "}
            Expires {new Date(session.expires_at).toLocaleTimeString()}.
          </p>
          <div className="flex flex-wrap gap-2">
            {session.mode === "agent" ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void command("takeover")}
                className="rounded border px-3 py-2"
              >
                Take control
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void command("snapshot")}
                  className="rounded border px-3 py-2"
                >
                  Read current page
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void command("scroll", { delta: 800 })}
                  className="rounded border px-3 py-2"
                >
                  Scroll down
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void command("scroll", { delta: -800 })}
                  className="rounded border px-3 py-2"
                >
                  Scroll up
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void command("release")}
                  className="rounded border px-3 py-2"
                >
                  Give control to Work
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void command("close")}
              className="rounded border px-3 py-2"
            >
              Close browser
            </button>
          </div>
          {view && session.mode === "takeover" && (
            <div className="space-y-2">
              <p className="break-words text-sm">
                {view.title} {view.url}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-sm">
                {view.text}
              </pre>
              <label className="block text-sm">
                Page control
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="mt-1 block w-full rounded border bg-background p-2"
                >
                  <option value="">Select a control</option>
                  {view.nodes?.map((node) => (
                    <option key={node.id} value={node.id} disabled={node.disabled}>
                      {node.label || node.kind} {node.inputType === "password" ? "(password)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {view.nodes?.find((node) => node.id === target)?.editable && (
                <label className="block text-sm">
                  Enter text privately
                  <input
                    type={
                      view.nodes?.find((node) => node.id === target)?.inputType === "password"
                        ? "password"
                        : "text"
                    }
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={4000}
                    className="mt-1 block w-full rounded border bg-background p-2"
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Check the destination and consequences before submitting any form, purchase,
                message, or deletion.
              </p>
              <div className="flex flex-wrap gap-2">
                {view.nodes?.find((node) => node.id === target)?.editable && (
                  <button
                    type="button"
                    disabled={disabled || !target}
                    onClick={() => void command("fill", { view: view.view, target, text })}
                    className="rounded border px-3 py-2"
                  >
                    Fill selected field
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled || !target}
                  onClick={() => void command("click", { view: view.view, target })}
                  className="rounded border px-3 py-2"
                >
                  Click selected control
                </button>
                <button
                  type="button"
                  disabled={disabled || !target}
                  onClick={() => void command("press", { view: view.view, target, key: "Enter" })}
                  className="rounded border px-3 py-2"
                >
                  Press Enter on selected control
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
