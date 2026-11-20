import { useCallback, useEffect, useRef, useState } from "react";
import {
  APPLE_HEALTH_DAY_MS,
  APPLE_HEALTH_HISTORY_DAYS,
  APPLE_HEALTH_METRICS,
} from "./apple-health-metrics.mjs";
import type { AppleHealthAnalytics, AppleHealthDay } from "./apple-health-export.mjs";

const updateEvent = "kova-health-update-v1";
type Bridge = { postMessage: (message: { action: "start" | "stop"; id: string }) => void };
function getBridge() {
  return (window as Window & { webkit?: { messageHandlers?: { kovaHealth?: Bridge } } }).webkit
    ?.messageHandlers?.kovaHealth;
}

function dayTime(date: unknown) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

function parseSnapshot(detail: unknown): AppleHealthAnalytics | null {
  if (!detail || typeof detail !== "object") return null;
  const { asOf, metrics } = detail as { asOf?: unknown; metrics?: Record<string, unknown> };
  const end = dayTime(asOf);
  if (typeof asOf !== "string" || !Number.isFinite(end) || !metrics || typeof metrics !== "object")
    return null;
  const report: AppleHealthAnalytics = { asOf, metrics: {} };
  for (const { id } of APPLE_HEALTH_METRICS) {
    const entries = metrics[id];
    if (!Array.isArray(entries) || entries.length > APPLE_HEALTH_HISTORY_DAYS) continue;
    const days = new Map<string, AppleHealthDay>();
    for (const entry of entries) {
      const time = dayTime(entry?.date);
      const value: unknown = entry?.value;
      if (
        !Number.isFinite(time) ||
        time > end ||
        end - time >= APPLE_HEALTH_HISTORY_DAYS * APPLE_HEALTH_DAY_MS ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1_000_000
      )
        continue;
      days.set(entry.date, { date: entry.date, value });
    }
    if (days.size) report.metrics[id] = [{ name: "Apple Health", days: [...days.values()] }];
  }
  return report;
}

const empty = { report: null, updatedAt: null, status: "" };

export function useAppleHealthLive(ownerId: string | null) {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const active = useRef<string | null>(null);
  const [reading, setReading] = useState<{
    report: AppleHealthAnalytics | null;
    updatedAt: number | null;
    status: string;
  }>(empty);

  const closeBridge = useCallback(() => {
    if (active.current) {
      const id = active.current;
      active.current = null;
      getBridge()?.postMessage({ action: "stop", id });
    }
  }, []);
  const stop = useCallback(() => {
    closeBridge();
    setConnected(false);
    setReading(empty);
  }, [closeBridge]);

  useEffect(() => {
    setAvailable(Boolean(ownerId && getBridge()));
    if (!ownerId) {
      stop();
      return;
    }
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!active.current || detail?.id !== active.current) return;
      const report = parseSnapshot(detail.report);
      if (!report) {
        if (detail.state === "error") {
          stop();
          setReading({
            ...empty,
            status: "Live updates are unavailable. Check Apple Health permissions and try again.",
          });
        }
        return;
      }
      const hasData = Object.keys(report.metrics).length > 0;
      setReading({
        report: hasData ? report : null,
        updatedAt: hasData ? Date.now() : null,
        status: hasData
          ? "Live updates are on"
          : "Waiting for readings from Apple Health. Check permissions in the Health app.",
      });
    };
    window.addEventListener(updateEvent, onUpdate);
    window.addEventListener("pagehide", stop);
    return () => {
      closeBridge();
      window.removeEventListener(updateEvent, onUpdate);
      window.removeEventListener("pagehide", stop);
    };
  }, [ownerId, closeBridge, stop]);

  const start = () => {
    const bridge = getBridge();
    if (!ownerId || !bridge || active.current) return;
    const id = crypto.randomUUID();
    active.current = id;
    setConnected(true);
    setReading({ ...empty, status: "Connecting to Apple Health…" });
    bridge.postMessage({ action: "start", id });
  };

  return { available, connected, ...reading, start, stop };
}
