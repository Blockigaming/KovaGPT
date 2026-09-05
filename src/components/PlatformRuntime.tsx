import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { platformEvents } from "@/platform/events";
import { recordMetric } from "@/platform/observability";
import { WorkSyncRuntime } from "@/components/WorkSyncStatus";

const DeveloperConsole = import.meta.env.DEV
  ? lazy(() =>
      import("./DeveloperConsole").then((module) => ({ default: module.DeveloperConsole })),
    )
  : null;

export function PlatformRuntime() {
  const location = useLocation();
  useEffect(() => {
    const started = performance.now();
    const frame = requestAnimationFrame(() => {
      recordMetric({
        name: "route.render",
        durationMs: performance.now() - started,
        timestamp: Date.now(),
        metadata: { path: location.pathname },
      });
      platformEvents.publish("platform", "route.viewed", { path: location.pathname });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  useEffect(() => {
    const unsubscribe = platformEvents.subscribe((event) => {
      void import("@/lib/operational-analytics").then((module) =>
        module.queueOperationalEvent(event),
      );
    });
    const flush = () => {
      void import("@/lib/operational-analytics").then((module) => module.flushOperationalEvents());
    };
    window.addEventListener("pagehide", flush);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return (
    <>
      <WorkSyncRuntime />
      {DeveloperConsole ? (
        <Suspense fallback={null}>
          <DeveloperConsole />
        </Suspense>
      ) : null}
    </>
  );
}
