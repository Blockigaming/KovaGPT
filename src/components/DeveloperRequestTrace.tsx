import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DeveloperServiceStatus } from "@/components/DeveloperServiceStatus";
import { Input } from "@/components/ui/input";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { developerUsageDimensions } from "@/lib/pricing/developer-usage-summary.mjs";
import type { DeveloperRequestTrace as Trace } from "@/lib/pricing/developer-request-trace.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function DeveloperRequestTrace({
  userId,
  requestId,
}: {
  userId: string;
  requestId?: string;
}) {
  const [draft, setDraft] = useState(requestId ?? "");
  const [result, setResult] = useState<Trace | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    setResult(null);
    setError("");
    void (async () => {
      try {
        const response = await fetchWithTimeoutAuthenticated(
          `/api/developer/console?trace=${encodeURIComponent(requestId)}`,
          { signal: controller.signal, headers: { "X-Kova-Expected-User": userId } },
          15000,
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Request not found in your workspace."
              : "Request diagnostics unavailable.",
          );
        const value = (await response.json()) as Trace;
        if (value.request?.id !== requestId) throw new Error("Invalid request diagnostics.");
        if (!controller.signal.aborted) setResult(value);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Request diagnostics unavailable.");
      }
    })();
    return () => controller.abort();
  }, [requestId, userId, refresh]);
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-border p-4"
      aria-label="Request diagnostics"
    >
      <h2 className="font-semibold">Request diagnostics</h2>
      <p className="text-xs text-muted-foreground">
        Look up a request ID from your own workspace. No request content or provider secrets are
        displayed.
      </p>
      <label className="block space-y-1 text-sm">
        Request ID
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={36} />
      </label>
      <div className="flex flex-wrap gap-2">
        {uuid.test(draft) ? (
          <Button asChild>
            <Link to="/developers/console" search={{ section: "logs", trace: draft }}>
              Inspect request
            </Link>
          </Button>
        ) : (
          <Button disabled>Inspect request</Button>
        )}
        {requestId && (
          <>
            <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
              Refresh trace
            </Button>
            <Button asChild variant="outline">
              <Link to="/developers/console" search={{ section: "logs" }}>
                Close trace
              </Link>
            </Button>
          </>
        )}
      </div>
      <DeveloperServiceStatus />
      {error && <p role="alert">{error}</p>}
      {requestId && !result && !error && <p role="status">Loading request diagnostics…</p>}
      {result && (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Request", result.request.id],
              ["Project", result.request.project_id],
              ["API key ID", result.request.api_key_id],
              ["Model", result.request.public_model],
              ["Service", result.request.capability],
              ["Settlement", result.request.settlement_state],
              [
                "Maximum reservation",
                `${result.request.maximum_reserved_charge ?? "Unknown"} ${result.request.currency} minor units`,
              ],
              [
                "Final charge",
                result.request.final_customer_charge === null
                  ? "Not settled"
                  : `${result.request.final_customer_charge} ${result.request.currency} minor units`,
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0 rounded-md border p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-all">{value ?? "Unknown"}</dd>
              </div>
            ))}
          </dl>
          <h3 className="text-sm font-medium">Recorded timeline (UTC)</h3>
          <ol className="space-y-1 text-sm">
            {result.timeline.map((event) => (
              <li key={event.stage} className="break-words">
                {event.stage}: {event.at}
              </li>
            ))}
          </ol>
          <h3 className="text-sm font-medium">Authoritative measurements</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(result.meters).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">
                  {developerUsageDimensions[key] ?? key}
                </dt>
                <dd>{value ?? "Not measured"}</dd>
              </div>
            ))}
          </dl>
          <h3 className="text-sm font-medium">Observed service outcomes</h3>
          <p className="text-xs text-muted-foreground">
            Last 24 hours for this project and service, latest{" "}
            {result.serviceObservation.sampleSize}
            {result.serviceObservation.truncated ? " (sample capped at 100)" : ""} records as of{" "}
            {result.serviceObservation.observedAt}. Provider health is unknown; these outcomes are
            not uptime.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(result.serviceObservation.counts).map(([key, count]) => (
              <div key={key}>
                <dt className="break-words text-xs text-muted-foreground">
                  {key.replaceAll("_", " ")}
                </dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
