import {
  CERTIFIED_LAUNCH_CONNECTORS,
  ConnectorError,
  requireLaunchConnector,
  normalizeScopes,
} from "./launch-contracts.mjs";
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Redacted metadata only. Available while uncertified so local disconnect remains reachable. */
export async function readLaunchManagement({ db, ownerId, connector, cursor = null, signal }) {
  const contract = requireLaunchConnector(connector);
  if (!uuid(ownerId) || (cursor !== null && !uuid(cursor)))
    throw new ConnectorError("invalid_cursor", 400);
  let query = db
    .from("integration_linked_accounts")
    .select(
      "id,account_label,provider_account_id,status,granted_scopes,token_expires_at,last_success_at",
    )
    .eq("owner_id", ownerId)
    .eq("provider_id", connector)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(20);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query.abortSignal(
    signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  );
  if (error || !Array.isArray(data) || data.length > 20)
    throw new ConnectorError("connector_store_unavailable", 503);
  let last = cursor;
  const accounts = data.map((row) => {
    if (!uuid(row.id) || (last !== null && row.id <= last))
      throw new ConnectorError("connector_store_unavailable", 503);
    last = row.id;
    return {
      id: row.id,
      label:
        typeof row.account_label === "string" ? row.account_label.slice(0, 200) : contract.name,
      identity:
        typeof row.provider_account_id === "string" ? row.provider_account_id.slice(0, 200) : "",
      status: typeof row.status === "string" ? row.status.slice(0, 80) : "unknown",
      scopes: normalizeScopes(row.granted_scopes).slice(0, 100),
      expiresAt: typeof row.token_expires_at === "string" ? row.token_expires_at : null,
      lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
    };
  });
  return {
    connector,
    certified: CERTIFIED_LAUNCH_CONNECTORS.includes(connector),
    accounts,
    nextCursor: accounts.length ? last : null,
  };
}
