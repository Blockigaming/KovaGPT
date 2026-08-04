import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLog } from "@/lib/audit.functions";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";

type Row = {
  id: string;
  provider: string;
  action: string;
  status: string;
  resource_id: string | null;
  summary: string | null;
  created_at: string;
};

function AuditLogPage() {
  const fetchRows = useServerFn(listAuditLog);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRows();
      setRows(data as Row[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          onClick={load}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No connected-account activity yet. Connect Google from the Apps page to get started.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              {r.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-medium capitalize">{r.provider}</span>{" "}
                  <span className="text-muted-foreground">·</span>{" "}
                  <span className="capitalize">{r.action}</span>
                </div>
                {r.summary && (
                  <div className="truncate text-sm text-muted-foreground">{r.summary}</div>
                )}
              </div>
              <time className="shrink-0 text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditLogErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="mb-4 text-sm text-destructive">{(error as Error).message}</p>
      <button
        className="rounded-md border px-3 py-1.5 text-sm"
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        Try again
      </button>
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
