/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Escape hatch for schema objects that exist in the production database but are
 * absent from the currently generated `types.ts`.
 *
 * The generated Supabase types are produced from whichever project the tooling
 * is bound to. When that project lags the production schema (new columns such as
 * `project_files.status`, `projects.deletion_requested_at`, or newer RPCs like
 * `claim_project_deletion`), the compiler rejects valid production queries.
 *
 * `loose()` only widens the *compile-time* typing of the client for a single
 * query chain. It performs no runtime work, changes no request, and must be used
 * exclusively at call sites that target verified production schema objects.
 */
export type LooseSupabaseClient = SupabaseClient<any, any, any>;

export function loose(client: unknown): LooseSupabaseClient {
  return client as LooseSupabaseClient;
}
