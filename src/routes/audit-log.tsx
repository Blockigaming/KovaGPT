import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OperationalState } from "@/components/OperationalState";
import { parseAuditLogRows, type AuditLogRow } from "@/lib/audit-response.mjs";
import { listAuditLog } from "@/lib/audit.functions";

function AuditLogPage() {
  const fetchRows = useServerFn(listAuditLog);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const data = parseAuditLogRows(await fetchRows());
      if (currentRequest !== requestId.current) return;
      setRows(data);
    } catch {
      if (currentRequest !== requestId.current) return;
      setRows([]);
      setFailed(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [fetchRows]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Recent actions KovaGPT performed on your connected accounts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh activity"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
        </button>
      </div>

      {loading ? (
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Loading activity…
        </div>
      ) : failed ? (
        <OperationalState
          state="unavailable"
          title="Activity unavailable"
          description="Your connected-account activity could not be loaded. Try again."
          onRetry={() => void load()}
        />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No connected-account activity yet. Connect Google from the Apps page to get started.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 px-4 py-3">
              {row.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-medium capitalize">{row.provider}</span>{" "}
                  <span className="text-muted-foreground">·</span>{" "}
                  <span className="capitalize">{row.action}</span>
                </div>
                {row.summary && (
                  <div className="truncate text-sm text-muted-foreground">{row.summary}</div>
                )}
              </div>
              <time className="shrink-0 text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditLogErrorComponent({ reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md p-8">
      <OperationalState
        state="unavailable"
        title="Activity unavailable"
        description="The Activity page could not be loaded. Try again."
        onRetry={() => {
          void router.invalidate();
          reset();
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/audit-log")({
  head: () => ({
    meta: [
      { title: "KovaGPT Activity" },
      { name: "description", content: "Recent connected-account actions performed by KovaGPT." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuditLogPage,
  errorComponent: AuditLogErrorComponent,
});
