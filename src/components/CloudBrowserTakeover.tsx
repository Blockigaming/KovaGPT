import { useEffect, useRef, useState } from "react";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { CloudBrowserPreview } from "./CloudBrowserPreview";
import { CloudBrowserViewport } from "./CloudBrowserViewport";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import {
  browserActivityIsFresh,
  type BrowserActivityMetadata,
} from "@/lib/browser-activity-contract.mjs";
import type {
  CloudBrowserControl,
  CloudBrowserFrame,
  CloudBrowserSize,
} from "@/lib/cloud-browser-control";

export function CloudBrowserTakeover({
  browser,
  ownerId,
  description,
  onClose,
  onCloseAutoFocus,
}: {
  browser: BrowserActivityMetadata;
  ownerId: string;
  description: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [frame, setFrame] = useState<CloudBrowserFrame | null>(null);
  const [size, setSize] = useState<CloudBrowserSize>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const controller = useRef<AbortController | null>(null);
  const leaving = useRef(false);
  const acquired = useRef(false);
  const pending = useRef(0);
  const path = browser.previewPath;

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    return () => {
      abort.abort();
      if (acquired.current && !leaving.current) {
        void request({ kind: "release" }, true).catch(() => undefined);
      }
    };
    // The selected browser dialog is remounted for a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, path]);

  function request(action: CloudBrowserControl, keepalive = false) {
    if (!path || !/^\/api\/browser\/preview\/[0-9a-f-]{36}$/i.test(path))
      return Promise.reject(new Error("This browser session has ended."));
    return fetchWithTimeoutAuthenticated(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Owner": ownerId },
        body: JSON.stringify(action),
        cache: "no-store",
        keepalive,
        signal: keepalive ? undefined : controller.current?.signal,
      },
      10000,
    );
  }

  function send(action: CloudBrowserControl) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || leaving.current) return Promise.resolve(false);
    if ((action.kind === "scroll" && pending.current >= 2) || pending.current >= 20)
      return Promise.resolve(false);
    pending.current++;
    const next = queue.current
      .then(async () => {
        if (signal.aborted || leaving.current) return false;
        try {
          const response = await request(action);
          const body = await response.json().catch(() => null);
          if (signal.aborted || leaving.current) return false;
          if (!response.ok || !body?.frame) {
            const text = body?.message ?? "This browser session has ended.";
            setMessage(text);
            if (response.status === 404 || response.status === 403) {
              setFrame(null);
              setHolding(false);
            }
            return false;
          }
          setMessage("");
          setFrame(body.frame as CloudBrowserFrame);
          return true;
        } catch {
          if (!signal.aborted && !leaving.current)
            setMessage("Cloud Browser could not complete that action.");
          return false;
        }
      })
      .finally(() => pending.current--);
    queue.current = next;
    return next;
  }

  useEffect(() => {
    if (!frame || !holding) return;
    const needsResize = size && (size.width !== frame.width || size.height !== frame.height);
    const refreshFrame = () => {
      if (document.visibilityState === "visible") void send({ kind: "frame", ...size });
    };
    const refresh = window.setTimeout(refreshFrame, needsResize ? 100 : 2500);
    document.addEventListener("visibilitychange", refreshFrame);
    return () => {
      window.clearTimeout(refresh);
      document.removeEventListener("visibilitychange", refreshFrame);
    };
    // The next rendered frame schedules a fresh passive refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, holding, size, message]);

  async function takeOver() {
    if (busy || holding) return;
    setBusy(true);
    acquired.current = true;
    setMessage("");
    const success = await send({ kind: "takeover" });
    if (!leaving.current && !controller.current?.signal.aborted) setHolding(success);
    setBusy(false);
  }

  function close() {
    leaving.current = true;
    if (acquired.current) void request({ kind: "release" }, true).catch(() => undefined);
    onClose();
  }

  return (
    <BrowserWorkspace
      title="Cloud browser"
      description={frame ? undefined : description}
      overlayHeader={Boolean(frame)}
      onClose={close}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={(event) => {
        if (
          event.target instanceof HTMLTextAreaElement &&
          event.target.classList.contains("kova-cloud-browser-keyboard")
        )
          event.preventDefault();
      }}
      actions={
        holding ? (
          <Button type="button" variant="ghost" onClick={close}>
            Return control
          </Button>
        ) : browserActivityIsFresh(browser) ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void takeOver()}>
            {busy ? "Opening…" : "Take over"}
          </Button>
        ) : null
      }
    >
      {frame && holding ? (
        <CloudBrowserViewport
          frame={frame}
          enabled
          onInput={(action) => void send(action)}
          onSizeChange={setSize}
        />
      ) : browserActivityIsFresh(browser) && !message ? (
        <div className="kova-browser-workspace-page">
          <CloudBrowserPreview browser={browser} ownerId={ownerId} />
        </div>
      ) : (
        <p className="kova-cloud-browser-status" role="status">
          {message || "This browser session has ended."}
        </p>
      )}
      {frame && message && (
        <span className="sr-only" role="alert">
          {message}
        </span>
      )}
    </BrowserWorkspace>
  );
}
