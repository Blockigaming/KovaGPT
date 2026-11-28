import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  checkDeveloperStatus,
  developerStatusProbes,
  type DeveloperProbe,
} from "@/lib/pricing/developer-service-status.mjs";

export function DeveloperServiceStatus() {
  const [results, setResults] = useState<DeveloperProbe[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function check() {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      const observations = await checkDeveloperStatus(
        fetch,
        AbortSignal.any([current.signal, AbortSignal.timeout(8000)]),
      );
      if (!current.signal.aborted) setResults(observations);
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Current service checks"
      className="my-3 space-y-3 rounded-lg border border-border p-4"
    >
      <h2 className="text-sm font-semibold">Current service checks</h2>
      <p className="text-sm text-muted-foreground">
        Point-in-time, credential-free checks. A ready authentication gate only confirms that an
        unauthenticated request was denied correctly. Provider execution, historical uptime and SLA
        remain unknown.
      </p>
      <Button variant="outline" onClick={() => void check()} disabled={busy}>
        {busy ? "Checking…" : "Check status"}
      </Button>
      <dl aria-live="polite" className="grid gap-2 text-sm sm:grid-cols-2">
        {developerStatusProbes.map((probe) => {
          const observation = results.find((row) => row.id === probe.id);
          return (
            <div key={probe.id} className="min-w-0 rounded-md border p-2">
              <dt>{probe.label}</dt>
              <dd className="capitalize">
                {busy ? "Checking" : (observation?.state ?? "Unknown")}
              </dd>
              <dd className="break-words text-xs text-muted-foreground">
                {busy ? "" : (observation?.checkedAt ?? "Not checked")}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
