import { useCallback, useEffect, useState } from "react";

export type ClientCapabilityState =
  | "loading"
  | "ready"
  | "degraded"
  | "unavailable"
  | "misconfigured"
  | "migration-required"
  | "schema-drift"
  | "database-timeout"
  | "authentication-required"
  | "plan-required"
  | "quota-exhausted"
  | "provider-timeout"
  | "temporarily-disabled"
  | "reconnect-required"
  | "billing-verification-pending"
  | "runner-unavailable"
  | "hosted-execution-unavailable"
  | "storage-unavailable";

export type ClientReadiness = {
  status: "ready" | "degraded" | "unavailable";
  checkedAt: string;
  capabilities: Record<string, { state: ClientCapabilityState; optional: boolean }>;
};

const TTL_MS = 15_000;
let snapshot: ClientReadiness | undefined;
let expiresAt = 0;
let pending: Promise<ClientReadiness> | undefined;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function invalidateReadiness() {
  expiresAt = 0;
  notify();
}

export async function getReadiness(signal?: AbortSignal): Promise<ClientReadiness> {
  if (snapshot && Date.now() < expiresAt) return snapshot;
  if (!pending) {
    pending = fetch("/api/readyz", { signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok && response.status !== 503) throw new Error("readiness_unavailable");
        return (await response.json()) as ClientReadiness;
      })
      .then((value) => {
        snapshot = value;
        expiresAt = Date.now() + TTL_MS;
        notify();
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

export function useReadiness() {
  const [value, setValue] = useState<ClientReadiness | undefined>(snapshot);
  const [error, setError] = useState(false);
  const refresh = useCallback(() => {
    invalidateReadiness();
    const controller = new AbortController();
    void getReadiness(controller.signal)
      .then(setValue)
      .catch(() => setError(true));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const listener = () => setValue(snapshot);
    listeners.add(listener);
    const controller = new AbortController();
    void getReadiness(controller.signal)
      .then(setValue)
      .catch(() => setError(true));
    return () => {
      controller.abort();
      listeners.delete(listener);
    };
  }, []);
  return { readiness: value, loading: !value && !error, error, refresh };
}

export function capabilityState(report: ClientReadiness | undefined, name: string) {
  return report?.capabilities[name]?.state ?? "loading";
}
