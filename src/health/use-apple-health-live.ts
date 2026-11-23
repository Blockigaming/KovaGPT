import { useCallback, useEffect, useRef, useState } from "react";
import {
  APPLE_HEALTH_DAY_MS,
  APPLE_HEALTH_HISTORY_DAYS,
  APPLE_HEALTH_METRICS,
} from "./apple-health-metrics.mjs";
import type { AppleHealthAnalytics, AppleHealthDay } from "./apple-health-export.mjs";

const updateEvent = "kova-health-update-v1";
type BridgeMessage = {
  action: "start" | "resume" | "stop" | "disconnect" | "record_steps";
  id: string;
  owner?: string;
  count?: string;
  start?: string;
  end?: string;
};
type HealthPlatform = "apple" | "android";
function getNativeHealthBridge() {
  if (typeof window === "undefined") return undefined;
  const nativeWindow = window as Window & {
    webkit?: {
      messageHandlers?: { kovaHealth?: { postMessage: (message: BridgeMessage) => void } };
    };
    kovaAndroidHealth?: { postMessage: (message: string) => void };
  };
  const apple = nativeWindow.webkit?.messageHandlers?.kovaHealth;
  if (apple)
    return {
      platform: "apple" as const,
      post: (message: BridgeMessage) => apple.postMessage(message),
    };
  const android = nativeWindow.kovaAndroidHealth;
  if (android)
    return {
      platform: "android" as const,
      post: (message: BridgeMessage) => android.postMessage(JSON.stringify(message)),
    };
}

const androidMetrics = new Set(["StepCount", "SleepAnalysis", "HeartRate"]);

function dayTime(date: unknown) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
}

function parseSnapshot(detail: unknown, platform: HealthPlatform): AppleHealthAnalytics | null {
  if (!detail || typeof detail !== "object") return null;
  const { asOf, metrics } = detail as { asOf?: unknown; metrics?: Record<string, unknown> };
  const end = dayTime(asOf);
  if (typeof asOf !== "string" || !Number.isFinite(end) || !metrics || typeof metrics !== "object")
    return null;
  const report: AppleHealthAnalytics = { asOf, metrics: {} };
  for (const { id, signed } of APPLE_HEALTH_METRICS) {
    if (platform === "android" && !androidMetrics.has(id)) continue;
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
        (!signed && value < 0) ||
        value > 1_000_000
      )
        continue;
      days.set(entry.date, { date: entry.date, value });
    }
    if (days.size)
      report.metrics[id] = [
        {
          name: platform === "apple" ? "Apple Health" : "Health Connect",
          days: [...days.values()],
        },
      ];
  }
  return report;
}

const writeMessages = {
  saved: "Steps saved on this device.",
  cancelled: "Step entry cancelled.",
  permission_required: "Allow step writing in your device’s health permissions, then try again.",
  invalid: "Enter a valid step count and a time range that has already ended.",
  error: "This device could not save the step entry.",
};

const empty = { report: null, updatedAt: null, status: "" };

export function useNativeHealthLive(ownerId: string | null) {
  const [platform, setPlatform] = useState<HealthPlatform | null>(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [canWriteSteps, setCanWriteSteps] = useState(false);
  const [writingSteps, setWritingSteps] = useState(false);
  const [stepWriteStatus, setStepWriteStatus] = useState("");
  const active = useRef<string | null>(null);
  const [reading, setReading] = useState<{
    report: AppleHealthAnalytics | null;
    updatedAt: number | null;
    status: string;
  }>(empty);

  const closeBridge = useCallback((action: "stop" | "disconnect" = "stop") => {
    if (active.current) {
      const id = active.current;
      active.current = null;
      getNativeHealthBridge()?.post({ action, id });
    }
  }, []);
  const stop = useCallback(() => {
    closeBridge();
    setCanWriteSteps(false);
    setWritingSteps(false);
    setStepWriteStatus("");
    setConnected(false);
    setPending(false);
    setReading(empty);
  }, [closeBridge]);

  const connect = useCallback(
    (action: "start" | "resume") => {
      const bridge = getNativeHealthBridge();
      if (!ownerId || !bridge || active.current) return;
      const id = crypto.randomUUID();
      active.current = id;
      setPending(true);
      const label = bridge.platform === "apple" ? "Apple Health" : "Health Connect";
      setReading({ ...empty, status: `Connecting to ${label}…` });
      bridge.post({ action, id, owner: ownerId });
    },
    [ownerId],
  );

  useEffect(() => {
    const bridge = getNativeHealthBridge();
    setPlatform(bridge?.platform ?? null);
    if (!ownerId || !bridge) {
      stop();
      return;
    }
    stop();
    const label = bridge.platform === "apple" ? "Apple Health" : "Health Connect";
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!active.current || detail?.id !== active.current) return;
      if (Object.hasOwn(writeMessages, detail.stepWriteState)) {
        setWritingSteps(false);
        setStepWriteStatus(writeMessages[detail.stepWriteState as keyof typeof writeMessages]);
        return;
      }
      const report = parseSnapshot(detail.report, bridge.platform);
      if (!report) {
        if (detail.state === "not_connected") {
          stop();
        } else if (detail.state === "paused") {
          setReading({ ...empty, status: "Live updates are paused." });
        } else if (detail.state === "unavailable") {
          stop();
          setReading({ ...empty, status: `${label} is unavailable on this device.` });
        } else if (detail.state === "permission_required") {
          stop();
          setReading({
            ...empty,
            status: `Allow at least one read permission in ${label} to connect.`,
          });
        } else if (detail.state === "error") {
          stop();
          setReading({
            ...empty,
            status: `Live updates are unavailable. Check ${label} permissions and try again.`,
          });
        }
        return;
      }
      setPending(false);
      setConnected(true);
      setCanWriteSteps(detail.canWriteSteps === true);
      const hasData = Object.keys(report.metrics).length > 0;
      setReading({
        report: hasData ? report : null,
        updatedAt: hasData ? Date.now() : null,
        status: hasData
          ? "Live updates are on"
          : `No readable data from ${label} yet. Check the device permissions.`,
      });
    };
    window.addEventListener(updateEvent, onUpdate);
    window.addEventListener("pagehide", stop);
    const resume = () => connect("resume");
    resume();
    window.addEventListener("pageshow", resume);
    return () => {
      closeBridge();
      window.removeEventListener(updateEvent, onUpdate);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", resume);
    };
  }, [ownerId, closeBridge, stop, connect]);

  function disconnect() {
    closeBridge("disconnect");
    stop();
  }

  function recordSteps(count: number, start: number, end: number) {
    const bridge = getNativeHealthBridge();
    const id = active.current;
    if (!bridge || !id || !connected || !canWriteSteps || writingSteps) return;
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 1_000_000 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start <= 0 ||
      start >= end ||
      end > Date.now()
    ) {
      setStepWriteStatus(writeMessages.invalid);
      return;
    }
    setWritingSteps(true);
    setStepWriteStatus("");
    try {
      bridge.post({
        action: "record_steps",
        id,
        count: String(count),
        start: String(start),
        end: String(end),
      });
    } catch {
      setWritingSteps(false);
      setStepWriteStatus(writeMessages.error);
    }
  }

  return {
    platform,
    pending,
    connected,
    ...reading,
    canWriteSteps,
    writingSteps,
    stepWriteStatus,
    recordSteps,
    start: () => connect("start"),
    disconnect,
  };
}

export type NativeHealthLive = ReturnType<typeof useNativeHealthLive>;
