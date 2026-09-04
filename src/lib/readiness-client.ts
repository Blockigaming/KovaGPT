import { fetchJsonWithTimeout } from "./fetch-with-timeout.ts";
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
  | "expired-auth"
  | "permission-denied"
  | "rate-limited"
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

export function operationalStateForHttpStatus(status: number): ClientCapabilityState {
  if (status === 401) return "expired-auth";
  if (status === 403) return "permission-denied";
  if (status === 429) return "rate-limited";
  if (status === 408 || status === 504) return "provider-timeout";
  if (status >= 500) return "unavailable";
  return "degraded";
}

const TTL_MS = 15_000;
let snapshot: ClientReadiness | undefined;
let expiresAt = 0;
let pending: Promise<ClientReadiness> | undefined;
const listeners = new Set<() => void>();

export function waitForReadiness<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    shared.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function invalidateReadiness() {
  expiresAt = 0;
  notify();
}

export async function getReadiness(signal?: AbortSignal): Promise<ClientReadiness> {
  if (snapshot && Date.now() < expiresAt) return snapshot;
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
  }
  if (!pending) {
    pending = fetchJsonWithTimeout<ClientReadiness>(
      "/api/readyz",
      { headers: { Accept: "application/json" } },
      10_000,
    )
      .then(({ response, body }) => {
        if (!response.ok && response.status !== 503) throw new Error("readiness_unavailable");
        return body;
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
  return waitForReadiness(pending, signal);
}

export function useReadiness() {
  const [value, setValue] = useState<ClientReadiness | undefined>(snapshot);
  const [error, setError] = useState(false);
  const refresh = useCallback(() => {
    invalidateReadiness();
    setError(false);
    void getReadiness()
      .then(setValue)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    const listener = () => setValue(snapshot);
    listeners.add(listener);
    const controller = new AbortController();
    void getReadiness(controller.signal)
      .then(setValue)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
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
