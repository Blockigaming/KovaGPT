import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type Source = {
  grantId: string;
  email: string;
  revision: number;
  state: "active" | "disabled" | "resync_required";
  watchConsent: boolean;
  watchExpiresAt: string | null;
};
type Status = { configured: { gmail: boolean }; watchConfigured: boolean; sources: Source[] };
async function sourceRequest(
  userId: string,
  grantId: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
): Promise<unknown> {
  let rejectAbort: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("Request canceled."));
  });
  signal.addEventListener("abort", rejectAbort, { once: true });
  if (signal.aborted) rejectAbort();
  try {
    const { data } = await Promise.race([supabase.auth.getSession(), canceled]);
    if (signal.aborted || data.session?.user.id !== userId || !data.session.access_token)
      throw new Error("Your account changed.");
    const response = await fetch(
      `/api/tasks/event-sources${body ? "" : `?expectedUserId=${encodeURIComponent(userId)}&grantId=${encodeURIComponent(grantId)}`}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify({ ...body, expectedUserId: userId }) : undefined,
        credentials: "omit",
        signal,
      },
    );
    if (!response.ok) throw new Error("Refresh the event source and try again.");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readResponseBytesBounded(response, 64000, { signal }),
      ),
    );
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}
export function TaskGmailEventSource({ grantId, userId }: { grantId: string; userId: string }) {
  return <SourceSession key={`${userId}:${grantId}`} grantId={grantId} userId={userId} />;
}
function SourceSession({ grantId, userId }: { grantId: string; userId: string }) {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string | null>(null);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const source = status?.sources.find((row) => row.grantId === grantId);
  const load = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const timer = setTimeout(() => next.abort(), 15000);
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = (await sourceRequest(userId, grantId, next.signal)) as Status;
      if (
        !value?.configured ||
        typeof value.configured.gmail !== "boolean" ||
        typeof value.watchConfigured !== "boolean" ||
        !Array.isArray(value.sources) ||
        value.sources.length > 20 ||
        value.sources.some(
          (row) =>
            typeof row.grantId !== "string" ||
            typeof row.email !== "string" ||
            row.email.length > 320 ||
            !Number.isSafeInteger(row.revision) ||
            row.revision < 1 ||
            typeof row.watchConsent !== "boolean" ||
            (row.watchExpiresAt !== null &&
              (typeof row.watchExpiresAt !== "string" ||
                !Number.isFinite(Date.parse(row.watchExpiresAt)))) ||
            !["active", "disabled", "resync_required"].includes(row.state),
        )
      )
        throw new Error("Invalid event source status.");
      if (current === generation.current) setStatus(value);
    } catch {
      if (current === generation.current) {
        setStatus(null);
        setError("Event source status is unavailable. Refresh to try again.");
      }
    } finally {
      clearTimeout(timer);
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [userId, grantId]);
  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    void load();
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userId)) return;
      invalidate();
      setStatus(null);
      void load();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      invalidate();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [load, userId, invalidate]);
  const change = async (action: "initialize" | "watch" | "disable") => {
    if (busyRef.current || !status) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const timer = setTimeout(() => next.abort(), 20000);
    let failed = false;
    try {
      await sourceRequest(userId, grantId, next.signal, {
        grantId,
        action,
        expectedRevision: source?.revision ?? 0,
      });
    } catch {
      failed = true;
    } finally {
      clearTimeout(timer);
      if (current === generation.current) {
        await load();
        if (failed && current + 1 === generation.current)
          setError(
            "The source change did not complete. Review its current status before retrying.",
          );
      }
    }
  };
  return (
    <section aria-label="Gmail event delivery" className="space-y-3 rounded-lg border p-3">
      <div>
        <h4 className="text-sm font-medium">Gmail event delivery</h4>
        <p className="text-xs text-muted-foreground">
          Track new inbox messages from this Google account. Starting or resetting uses a new
          baseline; earlier messages will not run Tasks.
        </p>
      </div>
      {source ? (
        <p className="break-all text-xs">
          {source.email} ·{" "}
          {source.state === "resync_required"
            ? "History expired; set a new baseline"
            : source.watchConsent &&
                source.watchExpiresAt &&
                Date.parse(source.watchExpiresAt) > Date.now()
              ? "Push watch active"
              : source.state === "disabled"
                ? "Stopped"
                : "Baseline saved; push watch required"}
        </p>
      ) : null}
      {!busy && status && !status.configured.gmail ? (
        <p className="text-xs text-muted-foreground">
          Gmail event delivery is not enabled in this deployment.
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-xs">
          Updating event source…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status?.configured.gmail}
          onClick={() => void change("initialize")}
        >
          {source ? "Reset baseline" : "Set baseline"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status?.watchConfigured || source?.state === "resync_required"}
          onClick={() => void change("watch")}
        >
          Enable Gmail push
        </Button>
        {source && source.state !== "disabled" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void change("disable")}
          >
            Stop event delivery
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
          Refresh source
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Enabling push registers and renews a Gmail watch for this grant. Stopping blocks local
        delivery; the provider watch expires naturally. Event tasks also require verified provider
        setup.
      </p>
    </section>
  );
}
