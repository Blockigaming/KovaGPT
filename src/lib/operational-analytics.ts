import type { PlatformEvent } from "@/platform/events";
import { submitOperationalEvents } from "./operational-analytics.functions";

type SafeEvent = {
  eventName: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean>;
};
const queue: SafeEvent[] = [];
let timer: number | undefined;
const supported = new Set(["route.viewed", "command.executed", "agent.imported", "agent.exported"]);
let lastSignature = "",
  lastQueuedAt = 0;

export function queueOperationalEvent(event: PlatformEvent) {
  if (navigator.doNotTrack === "1") return;
  if (!supported.has(event.name)) return;
  const payload =
    typeof event.payload === "object" && event.payload
      ? (event.payload as Record<string, unknown>)
      : {};
  const metadata: SafeEvent["metadata"] = {};
  if (event.name === "route.viewed" && typeof payload.path === "string")
    metadata.route = payload.path.split("?")[0].slice(0, 120);
  if (event.name === "command.executed" && typeof payload.command === "string")
    metadata.command = payload.command.slice(0, 120);
  if (
    (event.name === "agent.imported" || event.name === "agent.exported") &&
    typeof payload.sourceVersion === "number"
  )
    metadata.sourceVersion = payload.sourceVersion;
  const signature = JSON.stringify([event.name, metadata]),
    now = Date.now();
  if (signature === lastSignature && now - lastQueuedAt < 1000) return;
  lastSignature = signature;
  lastQueuedAt = now;
  queue.push({ eventName: event.name, occurredAt: event.occurredAt, metadata });
  if (queue.length > 20) queue.shift();
  if (timer) return;
  timer = window.setTimeout(() => void flushOperationalEvents(), 1000);
}

export async function flushOperationalEvents() {
  if (timer) window.clearTimeout(timer);
  timer = undefined;
  const events = queue.splice(0, 20);
  if (!events.length) return;
  try {
    await submitOperationalEvents({ data: { events } });
  } catch {
    // Analytics is deliberately failure-safe and never blocks the primary action.
  }
}
