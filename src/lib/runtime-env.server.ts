import { AsyncLocalStorage } from "node:async_hooks";

type RuntimeBindings = Record<string, unknown>;

// Cloudflare and other fetch-style runtimes pass secrets as the second fetch
// argument rather than copying them into process.env. Keep those bindings
// request-scoped so concurrent requests can never leak configuration into one
// another while retaining normal process.env support for Node deployments.
const RUNTIME_BINDINGS_KEY = Symbol.for("kovagpt.runtime-bindings");
const runtimeGlobal = globalThis as typeof globalThis & {
  [RUNTIME_BINDINGS_KEY]?: AsyncLocalStorage<RuntimeBindings>;
};

// The Vite server build can place this module in both the entry bundle and a
// lazy API chunk. A global symbol guarantees both copies use the exact same
// storage instance; otherwise bindings written by server.ts are invisible to
// /api/chat after code splitting.
const runtimeBindings =
  runtimeGlobal[RUNTIME_BINDINGS_KEY] ??
  (runtimeGlobal[RUNTIME_BINDINGS_KEY] = new AsyncLocalStorage<RuntimeBindings>());

export function withRuntimeBindings<T>(bindings: unknown, callback: () => T): T {
  const safeBindings =
    bindings && typeof bindings === "object" ? (bindings as RuntimeBindings) : Object.create(null);
  return runtimeBindings.run(safeBindings, callback);
}

export function runtimeEnv(name: string): string | undefined {
  const processValue = process.env[name];
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();

  const binding = runtimeBindings.getStore()?.[name];
  return typeof binding === "string" && binding.trim() ? binding.trim() : undefined;
}
