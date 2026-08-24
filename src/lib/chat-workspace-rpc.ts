// Adapter for the production chat-workspace RPC contract.
//
// Production (canonical) exposes atomic, authenticated-only functions:
//   get_chat_workspace_state, create_chat_message_version,
//   accept_chat_message_version, create_chat_branch, activate_chat_branch,
//   save_chat_custom_rules, delete_chat_custom_rules, pin_chat_source,
//   unpin_chat_source, get_chat_context_bundle
//
// Some databases were provisioned earlier with the `kova_`-prefixed spelling of
// the same behaviour. Callers always ask for the canonical name; when the
// database reports that the function does not exist we retry the legacy name
// once with its own argument mapping. Nothing else is retried, so a genuine
// failure is never masked.

/** Minimal structural shape so this works with any generated Supabase client. */
export type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string | null } | null;
  }>;
};

export type RpcResult = { data: unknown; error: { message: string; code?: string | null } | null };

/** Postgres/PostgREST signals for "no such function with that signature". */
export function isMissingFunction(error: { message: string; code?: string | null } | null) {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(error.message);
}

export async function callWorkspaceRpc(
  client: RpcClient,
  canonical: { name: string; args: Record<string, unknown> },
  legacy?: { name: string; args: Record<string, unknown> },
): Promise<RpcResult> {
  const first = await client.rpc(canonical.name, canonical.args);
  if (!first.error || !legacy || !isMissingFunction(first.error)) return first;
  return client.rpc(legacy.name, legacy.args);
}

/** Drop undefined/null entries: RPC defaults must apply when a value is unset. */
export function definedArgs(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
