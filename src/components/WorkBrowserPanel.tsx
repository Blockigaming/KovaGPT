import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Globe2, Monitor } from "lucide-react";
import "./work-browser-preview.css";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";
import type { BrowserCommand, BrowserResult } from "@/lib/work-browser-transport.mjs";
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
    [checking, setChecking] = useState(true),
    [statusConfirmed, setStatusConfirmed] = useState(false),
    [controlsOpen, setControlsOpen] = useState(false),
    [cleared, setCleared] = useState(false);
  const controlsId = useId();
  const lifetime = useRef<AbortController | null>(null),
    serial = useRef(0),
    busyRef = useRef(false);
  async function refresh() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busyRef.current) return;
    setChecking(true);
    setStatusConfirmed(false);
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
      setStatusConfirmed(true);
      setError(null);
      setView((old) =>
        old &&
        value.sessions.some((item) => item.id === old.sessionId && item.sequence === old.sequence)
          ? old
          : null,
      );
    } catch {
      if (!signal.aborted && captured === serial.current) {
        setView(null);
        setError("Browser status could not be confirmed. Refresh before another action.");
      }
    } finally {
      if (!signal.aborted && captured === serial.current) setChecking(false);
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
      setControlsOpen(false);
      setStatusConfirmed(false);
    });
    lifetime.current = active.controller;
    return () => {
      active.dispose();
    };
  }, [ownerId, run.id]);
  useEffect(() => {
    void refresh();
    // Refresh authoritative browser status when execution changes. The API still
    // rechecks ownership, paused state, revision and sequence for every command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, run.id, run.revision, run.status]);
  const session = snapshot?.sessions[0],
    paused = run.status === "paused" && !run.step && run.effect?.status !== "started",
    confirmedPaused =
      paused && snapshot?.runStatus === "paused" && snapshot.runRevision === run.revision,
    disabled =
      busy || checking || !statusConfirmed || !confirmedPaused || !snapshot?.readiness.available;
  async function command(
    operation: BrowserCommand["operation"],
    extra: Record<string, unknown> = {},
  ) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busyRef.current) return;
    if (operation !== "close" && disabled) return;
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
      if (
        response.result?.runId !== run.id ||
        response.result.sessionId !== body.sessionId ||
        response.result.sequence !== body.expectedSequence + 1 ||
        !Number.isFinite(response.expiresAt)
      )
        throw Error("invalid");
      setView(response.result.closed ? null : response.result);
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
      if (!signal.aborted && captured === serial.current) {
        setStatusConfirmed(false);
        setError(
          "The action is not confirmed. Refresh status; do not repeat a submitted form or purchase until you check its result.",
        );
      }
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
  let domain = "No page captured";
  if (view?.url) {
    try {
      domain = new URL(view.url).hostname;
    } catch {
      // A malformed display URL never becomes an external navigation target.
    }
  }
  const previewText = view?.text?.trim(),
    available = Boolean(snapshot?.readiness.available || session),
    status = checking
      ? "Checking browser status…"
      : !statusConfirmed
        ? "Browser status unconfirmed"
        : session?.mode === "takeover"
          ? "You have control · automation blocked"
          : session
            ? paused
              ? "Agent control · run paused"
              : "Agent control"
            : "No open session";
  function toggleControls() {
    setControlsOpen((open) => !open);
    // Hiding the controls also discards any unsubmitted private entry.
    setText("");
    setTarget("");
  }
  return (
    <section
      aria-label="Private Work browser"
      className="work-browser-panel"
      data-ui-reference="chatgpt.agent.browser-card"
    >
      <div className="work-browser-heading">
        <h4>
          <Monitor aria-hidden="true" /> Cloud browser
        </h4>
        <span className="work-browser-status" role="status">
          {status}
        </span>
      </div>
      <button
        type="button"
        className="work-browser-preview"
        data-ui-reference="chatgpt.agent.browser-preview"
        aria-label={controlsOpen ? "Hide browser controls" : "Open browser controls"}
        aria-expanded={controlsOpen}
        aria-controls={controlsId}
        disabled={!available}
        onClick={toggleControls}
      >
        <span className="work-browser-preview-chrome">
          <span className="work-browser-domain">
            <Globe2 aria-hidden="true" />
            {domain}
          </span>
          <span className="work-browser-preview-kind">Text preview</span>
        </span>
        <span className="work-browser-preview-body">
          <span className="work-browser-preview-title">
            {view?.title || (session ? "Private browser session" : "Open a private browser")}
          </span>
          <span className="work-browser-preview-text">
            {previewText
              ? previewText.slice(0, 480)
              : session?.mode === "takeover"
                ? "Open the controls and read the current page to see its text here."
                : session
                  ? "Pause this run, then take over to read the current page."
                  : checking
                    ? "Checking whether private browsing is available."
                    : available
                      ? "Open a reviewed website to begin a private session."
                      : "Private browser execution is unavailable."}
          </span>
        </span>
        <span className="work-browser-preview-footer">
          <span>{controlsOpen ? "Hide controls" : "Open controls"}</span>
          <ChevronDown aria-hidden="true" />
        </span>
      </button>
      {session && (
        <div className="work-browser-actions">
          {session.mode === "agent" ? (
            <Button
              variant="ghost"
              type="button"
              disabled={disabled}
              onClick={() => {
                setControlsOpen(true);
                void command("takeover");
              }}
              className="work-browser-primary-action"
            >
              Take over
            </Button>
          ) : (
            <Button
              variant="ghost"
              type="button"
              disabled={disabled}
              onClick={() => void command("release")}
              className="work-browser-primary-action"
            >
              Return control
            </Button>
          )}
          <Button
            variant="ghost"
            type="button"
            disabled={busy || checking}
            onClick={() => void command("close")}
          >
            End session
          </Button>
        </div>
      )}
      {session?.mode === "takeover" && (
        <p className="text-sm text-muted-foreground">
          You have control. Automation is blocked during takeover. Return control, then use Resume
          run to continue.
        </p>
      )}
      {session?.mode === "agent" && paused && (
        <p className="text-sm text-muted-foreground">
          Browser control is with the agent. This run is still paused; use Resume run to continue.
        </p>
      )}
      {!paused && available && (
        <p role="status" className="text-sm">
          Pause this run and wait for its current step to settle before taking over.
        </p>
      )}
      {paused && statusConfirmed && !confirmedPaused && (
        <p role="status" className="text-sm">
          Run status has changed. Refresh execution and browser status before taking over.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="link"
        type="button"
        disabled={busy || checking}
        onClick={() => void refresh()}
        className="work-browser-refresh text-sm underline"
      >
        {checking ? "Checking browser status…" : "Refresh browser status"}
      </Button>
      {controlsOpen && (
        <div id={controlsId} className="work-browser-controls">
          <p className="text-sm text-muted-foreground">
            Pause Work before taking over. The model cannot read or act during takeover. Sessions
            close after five minutes; sign-in data is not saved to Work history. Hiding these
            controls does not end the session.
          </p>
          <p className="break-words text-xs">
            Reviewed sites: {snapshot?.readiness.origins.join(", ")}
          </p>
          {!session && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 text-sm">
                Reviewed website URL
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  maxLength={2048}
                  className="block w-full border bg-background"
                />
              </label>
              <Button
                variant="outline"
                type="button"
                disabled={disabled || !url}
                onClick={() => void command("open", { url })}
                className="border"
              >
                Open and take over
              </Button>
            </div>
          )}
          {session && (
            <>
              <p className="text-xs text-muted-foreground">
                Session expires {new Date(session.expires_at).toLocaleTimeString()}.
              </p>
              {session.mode === "takeover" && (
                <div className="work-browser-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={disabled}
                    onClick={() => void command("snapshot")}
                  >
                    Read current page
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={disabled}
                    onClick={() => void command("scroll", { delta: 800 })}
                  >
                    Scroll down
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={disabled}
                    onClick={() => void command("scroll", { delta: -800 })}
                  >
                    Scroll up
                  </Button>
                </div>
              )}
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
                    <Select
                      value={target || "no-page-control"}
                      onValueChange={(value) => setTarget(value === "no-page-control" ? "" : value)}
                    >
                      <SelectTrigger aria-label="Page control" className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-page-control">Select a control</SelectItem>
                        {view.nodes?.map((node) => (
                          <SelectItem key={node.id} value={node.id} disabled={node.disabled}>
                            {node.label || node.kind}{" "}
                            {node.inputType === "password" ? "(password)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {view.nodes?.find((node) => node.id === target)?.editable && (
                    <label className="block text-sm">
                      Enter text privately
                      <Input
                        type={
                          view.nodes?.find((node) => node.id === target)?.inputType === "password"
                            ? "password"
                            : "text"
                        }
                        autoComplete="off"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        maxLength={4000}
                        className="mt-1 block w-full border bg-background"
                      />
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Check the destination and consequences before submitting any form, purchase,
                    message, or deletion.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {view.nodes?.find((node) => node.id === target)?.editable && (
                      <Button
                        variant="outline"
                        type="button"
                        disabled={disabled || !target}
                        onClick={() => void command("fill", { view: view.view, target, text })}
                        className="border"
                      >
                        Fill selected field
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      type="button"
                      disabled={disabled || !target}
                      onClick={() => void command("click", { view: view.view, target })}
                      className="border"
                    >
                      Click selected control
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={disabled || !target}
                      onClick={() =>
                        void command("press", { view: view.view, target, key: "Enter" })
                      }
                      className="border"
                    >
                      Press Enter on selected control
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
