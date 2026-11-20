import { Input } from "@/components/ui/input";
import { BrowserInteractionCard } from "@/components/BrowserInteractionCard";
import { BrowserWorkspace } from "@/components/BrowserWorkspace";
import { WorkBrowserViewport } from "@/components/WorkBrowserViewport";
import { Button } from "@/components/ui/button";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import "./work-browser-preview.css";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";
import type {
  BrowserCommand,
  BrowserResult,
  BrowserVisualInput,
  BrowserViewportSize,
} from "@/lib/work-browser-transport.mjs";
import { requestWorkSync } from "@/lib/work-sync-client";
import { createWorkViewLifetime } from "@/lib/work-view-lifetime.mjs";

type Session = { id: string; sequence: number; mode: string; expires_at: string };
type Snapshot = {
  readiness: { available: boolean; visualTakeover?: boolean };
  runRevision: number;
  runStatus: string;
  sessions: Session[];
};
type CommandFields = Pick<BrowserCommand, "url" | "view" | "target" | "text" | "visual">;
const capture = { kind: "capture" } as const;

export function WorkBrowserPanel({ ownerId, run }: { ownerId: string; run: WorkRun }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<BrowserResult | null>(null);
  const [viewportSize, setViewportSize] = useState<BrowserViewportSize>();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusConfirmed, setStatusConfirmed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [queued, setQueued] = useState(0);
  const openButton = useRef<HTMLButtonElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const busyRef = useRef(false);
  const openRef = useRef(false);
  const queue = useRef<BrowserVisualInput[]>([]);

  const session = snapshot?.sessions[0];
  const paused = run.status === "paused" && !run.step && run.effect?.status !== "started";
  const confirmedPaused =
    paused && snapshot?.runStatus === "paused" && snapshot.runRevision === run.revision;
  const ready = Boolean(snapshot?.readiness.available && snapshot.readiness.visualTakeover);
  const usable = statusConfirmed && confirmedPaused && ready && !checking;
  const takeover = session?.mode === "takeover";
  const disabled = !usable || busy;
  const canEnd = Boolean(session && !busy && !checking);

  function hideWorkspace() {
    openRef.current = false;
    queue.current = [];
    setWorkspaceOpen(false);
    setView(null);
    setUrl("");
  }

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
      if (!Array.isArray(value.sessions) || !value.readiness) throw Error("invalid");
      setSnapshot(value);
      if (value.sessions[0]?.mode === "agent") hideWorkspace();
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
        setError("Browser status could not be confirmed.");
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
      hideWorkspace();
      setError(null);
      setStatusConfirmed(false);
    });
    lifetime.current = active.controller;
    return () => {
      active.dispose();
    };
  }, [ownerId, run.id]);

  const refreshForRun = useEffectEvent(refresh);
  useEffect(() => {
    void refreshForRun();
  }, [ownerId, run.id, run.revision, run.status]);

  async function command(operation: BrowserCommand["operation"], fields: CommandFields = {}) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busyRef.current) return;
    if (operation === "close" ? !canEnd : !usable) return;
    const readOnly = fields.visual?.kind === "frame";
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
      ...fields,
    };
    const captured = ++serial.current;
    try {
      const response = (await requestWorkSync(ownerId, "/api/work/browser", signal, body)) as {
        result: BrowserResult;
        expiresAt: number;
      };
      if (signal.aborted || captured !== serial.current) return;
      const { result, expiresAt } = response;
      if (
        result?.runId !== run.id ||
        result.sessionId !== body.sessionId ||
        result.sequence !== body.expectedSequence + (readOnly ? 0 : 1) ||
        !Number.isFinite(expiresAt) ||
        (fields.visual && result.mode !== "takeover")
      )
        throw Error("invalid");
      if (result.closed || result.mode === "agent") hideWorkspace();
      else if (fields.visual && openRef.current) setView(result);
      if (!readOnly)
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                sessions: result.closed
                  ? []
                  : [
                      {
                        id: body.sessionId,
                        sequence: result.sequence,
                        mode: result.mode ?? "takeover",
                        expires_at: new Date(expiresAt).toISOString(),
                      },
                    ],
              }
            : previous,
        );
    } catch {
      if (!signal.aborted && captured === serial.current) {
        queue.current = [];
        setView(null);
        setStatusConfirmed(false);
        setError(
          readOnly
            ? "The live browser disconnected."
            : "The last browser action could not be confirmed.",
        );
      }
    } finally {
      busyRef.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  const readFrame = useEffectEvent(
    () =>
      void command("snapshot", {
        visual: viewportSize ? { kind: "frame", ...viewportSize } : { kind: "frame" },
      }),
  );
  useEffect(() => {
    if (!workspaceOpen || !takeover || !usable || busy || view?.interaction) return;
    const needsResize =
      viewportSize &&
      view?.frame &&
      (view.frame.width !== viewportSize.width || view.frame.height !== viewportSize.height);
    const timer = window.setTimeout(
      () => {
        if (document.visibilityState === "visible") readFrame();
      },
      view ? (needsResize ? 120 : 3500) : 0,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") readFrame();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceOpen, takeover, usable, busy, view, viewportSize]);

  const sendNextInput = useEffectEvent(() => {
    const next = queue.current.shift();
    if (next) void command("snapshot", { visual: next });
  });
  useEffect(() => {
    if (workspaceOpen && takeover && usable && !busy) sendNextInput();
  }, [workspaceOpen, takeover, usable, busy, queued]);

  function sendInput(input: BrowserVisualInput) {
    if (!usable || !takeover || view?.interaction || queue.current.length >= 32) return;
    if (input.kind === "input") {
      const previous = queue.current.at(-1);
      const text = previous?.kind === "input" ? previous.text + input.text : input.text;
      if (new TextEncoder().encode(text).length > 3000) return;
      if (previous?.kind === "input") queue.current.pop();
      input = { kind: "input", text };
    }
    queue.current.push(input);
    setQueued((count) => count + 1);
  }

  if (cleared)
    return (
      <p className="text-sm text-muted-foreground">
        Private browser controls were cleared from this view.
      </p>
    );

  const allow = view?.nodes?.find((node) => node.kind === "interaction_allow");
  const deny = view?.nodes?.find((node) => node.kind === "interaction_deny");
  const frame = view?.frame;
  const status = checking
    ? "Checking browser status…"
    : (error ??
      (!ready
        ? "Live browser unavailable"
        : takeover
          ? "You have control"
          : session
            ? "Agent has control"
            : "No open session"));

  return (
    <>
      <section className="work-browser-panel" aria-label="Private Work browser">
        <div className="work-browser-heading">
          <h4>
            <Monitor aria-hidden="true" /> Cloud browser
          </h4>
          <span className="work-browser-status" role="status">
            {status}
          </span>
        </div>
        <div className="work-browser-actions">
          <Button
            ref={openButton}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              openRef.current = true;
              setWorkspaceOpen(true);
              if (session && !takeover) void command("takeover", { visual: capture });
            }}
          >
            {session && !takeover ? "Take over" : "Open browser"}
          </Button>
          {canEnd && !workspaceOpen && (
            <Button type="button" variant="ghost" onClick={() => void command("close")}>
              End session
            </Button>
          )}
          {error && (
            <Button type="button" variant="ghost" onClick={() => void refresh()}>
              Retry
            </Button>
          )}
        </div>
      </section>
      {workspaceOpen && (
        <BrowserWorkspace
          title="Cloud browser"
          overlayHeader={Boolean(frame && takeover && usable)}
          onClose={hideWorkspace}
          onEscapeKeyDown={(event) => {
            if (
              event.target instanceof HTMLTextAreaElement &&
              event.target.classList.contains("work-browser-keyboard")
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openButton.current?.focus({ preventScroll: true });
          }}
          actions={
            takeover && (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || Boolean(view?.interaction)}
                onClick={() => {
                  queue.current = [];
                  void command("release");
                }}
              >
                Return control
              </Button>
            )
          }
        >
          {error ? (
            <div className="work-browser-message">
              <p role="alert">{error}</p>
              <Button type="button" variant="outline" onClick={() => void refresh()}>
                Reconnect
              </Button>
            </div>
          ) : view?.interaction && view.view && allow && deny ? (
            <div className="work-browser-message">
              <BrowserInteractionCard
                key={view.view}
                interaction={view.interaction}
                disabled={disabled}
                onAllow={(text) =>
                  void command("click", {
                    visual: capture,
                    view: view.view,
                    target: allow.id,
                    ...(text !== undefined ? { text } : {}),
                  })
                }
                onDeny={() =>
                  void command("click", { visual: capture, view: view.view, target: deny.id })
                }
              />
            </div>
          ) : frame && takeover && usable ? (
            <WorkBrowserViewport
              frame={frame}
              enabled={usable}
              onInput={sendInput}
              onSizeChange={setViewportSize}
            />
          ) : !session && !busy && usable ? (
            <form
              className="work-browser-address"
              onSubmit={(event) => {
                event.preventDefault();
                void command("open", { url: url.trim(), visual: capture });
              }}
            >
              <Input
                type="url"
                aria-label="Website URL"
                value={url}
                maxLength={2048}
                placeholder="https://example.com"
                onChange={(event) => setUrl(event.target.value)}
                required
              />
              <Button type="submit" disabled={!url.trim()}>
                Go
              </Button>
            </form>
          ) : (
            <div className="work-browser-message" role="status">
              {usable || busy || checking ? "Connecting…" : "Live browser unavailable"}
            </div>
          )}
        </BrowserWorkspace>
      )}
    </>
  );
}
