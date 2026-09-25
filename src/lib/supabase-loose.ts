// Compile-time-only escape hatch for production-schema columns and RPCs that
// the editor-generated Supabase types do not include. This module is for
// narrowing call sites only — it adds no runtime behavior and must never be
// imported by client bundles (`.ts` suffix keeps it out of *.functions graphs).
import type { SupabaseClient } from "@supabase/supabase-js";

export type LooseSupabaseClient = Omit<SupabaseClient, "from" | "rpc"> & {
  // Production schema columns and RPCs live ahead of the generated types.
  // Call sites that touch them are wrapped with loose() so the application
  // typechecks without weakening the rest of the graph.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (relation: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => any;
};

export function loose(client: SupabaseClient): LooseSupabaseClient {
  return client as unknown as LooseSupabaseClient;
}
