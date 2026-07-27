import { useEffect, useState } from "react";
import { Activity, Boxes, Flag, Puzzle, X } from "lucide-react";
import { CAPABILITIES, validateCapabilityRegistry } from "@/platform/capabilities";
import { FEATURE_FLAGS } from "@/platform/feature-flags";
import { extensionRegistry } from "@/platform/extensions";
import { getMetrics } from "@/platform/observability";
import { platformEvents, type PlatformEvent } from "@/platform/events";

export function DeveloperConsole() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => platformEvents.subscribe(() => setEvents(platformEvents.snapshot())), []);
  useEffect(() => {
    if (!open) return;
    setEvents(platformEvents.snapshot());
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);
  const metrics = getMetrics().slice(-20).reverse();
  void revision;
  if (!open) return null;
  const errors = validateCapabilityRegistry();
  return (
    <aside
      className="fixed inset-y-3 right-3 z-[100] flex w-[min(94vw,34rem)] flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-2xl backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="KovaGPT developer console"
    >
      <header className="flex items-center gap-2 border-b p-3">
        <Activity className="h-4 w-4" />
        <h2 className="font-semibold">Platform Inspector</h2>
        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700">
          Development only
        </span>
        <button
          className="ml-auto rounded-lg p-2 hover:bg-accent"
          onClick={() => setOpen(false)}
          aria-label="Close developer console"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="grid flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
        <section>
          <h3 className="flex items-center gap-2 font-medium">
            <Boxes className="h-4 w-4" />
            Capabilities ({CAPABILITIES.length})
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {errors.length ? errors.join("; ") : "Registry valid"}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {CAPABILITIES.map((item) => (
              <li key={item.id} className="rounded-lg border p-2">
                <strong>{item.label}</strong>
                <span className="block text-muted-foreground">
                  {item.route} · {item.requiredPlan} · {item.permission}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <div className="space-y-4">
          <section>
            <h3 className="flex items-center gap-2 font-medium">
              <Flag className="h-4 w-4" />
              Feature flags
            </h3>
            <ul className="mt-2 space-y-1 text-xs">
              {FEATURE_FLAGS.map((flag) => (
                <li key={flag.id} className="flex justify-between rounded-lg border p-2">
                  <span>{flag.id}</span>
                  <span>{flag.killSwitch ? "killed" : flag.defaultEnabled ? "on" : "off"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="flex items-center gap-2 font-medium">
              <Puzzle className="h-4 w-4" />
              Extensions
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {extensionRegistry.list().length} registered extensions
            </p>
          </section>
          <section>
            <h3 className="font-medium">Recent timings</h3>
            <ol className="mt-2 space-y-1 text-xs">
              {metrics.length ? (
                metrics.map((metric, index) => (
                  <li
                    key={`${metric.timestamp}-${index}`}
                    className="flex justify-between rounded-lg border p-2"
                  >
                    <span>{metric.name}</span>
                    <span>{metric.durationMs.toFixed(1)} ms</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No metrics recorded yet.</li>
              )}
            </ol>
          </section>
          <section>
            <h3 className="font-medium">Event timeline</h3>
            <ol className="mt-2 space-y-1 text-xs">
              {events
                .slice(-20)
                .reverse()
                .map((event) => (
                  <li key={event.id} className="rounded-lg border p-2">
                    <span>
                      {event.domain}.{event.name}
                    </span>
                    <time className="block text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleTimeString()}
                    </time>
                  </li>
                ))}
            </ol>
          </section>
        </div>
      </div>
    </aside>
  );
}
