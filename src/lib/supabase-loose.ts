/* eslint-disable @typescript-eslint/no-explicit-any */
// Structural escape hatch for queries that target production columns and RPCs
// which the generated Supabase types do not yet describe. Runtime behavior is
// unchanged; only compile-time narrowing is relaxed at the specific call sites.

export type LooseClient = {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): any;
  storage: any;
  auth: any;
};

export function loose(client: unknown): LooseClient {
  return client as LooseClient;
}
