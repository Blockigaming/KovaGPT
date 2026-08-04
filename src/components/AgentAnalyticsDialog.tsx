import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { getAgentAnalytics, type AgentAnalytics } from "@/lib/agent-analytics.functions";
import type { SavedAgent } from "@/lib/agent-definitions.functions";

const entries = (value: Record<string, number>) =>
  Object.entries(value).sort((a, b) => b[1] - a[1]);

export function AgentAnalyticsDialog({
  agent,
  onClose,
}: {
  agent: SavedAgent | null;
  onClose: () => void;
}) {
  const load = useServerFn(getAgentAnalytics);
  const [days, setDays] = useState<7 | 30 | 90>(30),
    [data, setData] = useState<AgentAnalytics | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!agent) return;
    setLoading(true);
    load({ data: { id: agent.id, days } })
      .then(setData)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Analytics unavailable"),
      )
      .finally(() => setLoading(false));
  }, [agent, days, load]);
  const summary = useMemo(
    () =>
      data
        ? `${data.total} runs; ${data.completed} completed; ${data.failed} failed; ${data.cancelled} cancelled.`
        : "",
    [data],
  );
  const download = () => {
    if (!data || !agent) return;
    const rows = [
      "run_id,status,definition_version,project_id,started_at,completed_at,failure_category,tool_call_count,retry_count,provider_id,model_id",
      ...data.recent.map((run) =>
        [
          run.id,
          run.status,
          run.agent_definition_version ?? "",
          run.project_id ?? "",
          run.started_at ?? "",
          run.completed_at ?? "",
          run.failure_category ?? "",
          run.tool_call_count,
          run.retry_count,
          run.provider_id ?? "",
          run.model_id ?? "",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      ),
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${agent.name.replace(/[^a-z0-9_-]+/gi, "-") || "agent"}-analytics.csv`;
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <Dialog open={Boolean(agent)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:w-[min(92vw,860px)]">
        <DialogHeader>
          <DialogTitle>{agent?.name} analytics</DialogTitle>
          <DialogDescription>
            Owner-scoped operational metadata only. Objectives, prompts, logs, and memory are
            excluded.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            Date range{" "}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}
              className="ml-2 h-10 rounded-lg border bg-background px-2"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            disabled={!data}
            onClick={download}
            className="min-h-10 rounded-lg border px-3 text-sm disabled:opacity-40"
          >
            Export metadata CSV
          </button>
        </div>
        {loading ? (
          <p role="status" className="rounded-xl bg-muted p-4">
            Loading agent analytics…
          </p>
        ) : data ? (
          <>
            <p className="sr-only" role="status">
              {summary}
            </p>
            <dl
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              aria-label="Agent analytics summary"
            >
              {[
                ["Total runs", data.total],
                ["Completed", data.completed],
                ["Failed", data.failed],
                ["Cancelled", data.cancelled],
                ["Active", data.active],
                [
                  "Completion rate",
                  data.completionRate === null ? "Not enough data" : `${data.completionRate}%`,
                ],
                [
                  "Median runtime",
                  data.medianRuntimeSeconds === null ? "No data" : `${data.medianRuntimeSeconds}s`,
                ],
                [
                  "P90 runtime",
                  data.p90RuntimeSeconds === null
                    ? "Not enough data"
                    : `${data.p90RuntimeSeconds}s`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-3 sm:grid-cols-3">
              <Breakdown title="Status" values={data.statuses} />
              <Breakdown title="Tools" values={data.tools} />
              <Breakdown title="Versions" values={data.versions} />
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <caption className="p-3 text-left font-medium">
                  Recent attributed executions
                </caption>
                <thead>
                  <tr className="border-t">
                    <th className="p-2">Status</th>
                    <th className="p-2">Version</th>
                    <th className="p-2">Started</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="p-2">{run.status}</td>
                      <td className="p-2">{run.agent_definition_version ?? "Legacy"}</td>
                      <td className="p-2">
                        {new Date(run.started_at ?? run.created_at).toLocaleString()}
                      </td>
                      <td className="p-2">
                        {run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}
                      </td>
                      <td className="p-2">{run.tool_call_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            No analytics are available.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
function Breakdown({ title, values }: { title: string; values: Record<string, number> }) {
  const rows = entries(values).slice(0, 8);
  return (
    <section className="rounded-xl border p-3" aria-label={`${title} breakdown`}>
      <h3 className="font-medium">{title}</h3>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map(([label, count]) => (
            <li key={label} className="flex justify-between gap-2">
              <span className="truncate">{label}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No data</p>
      )}
    </section>
  );
}
