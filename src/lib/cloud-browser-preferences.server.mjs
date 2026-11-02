import { parseCloudBrowserRules } from "./cloud-browser-rules.mjs";
import { workUuid } from "./work-execution-protocol.mjs";
async function readRow(client, ownerId) {
  workUuid(ownerId);
  const result = await client
    .from("user_preferences")
    .select("settings,updated_at")
    .eq("user_id", ownerId)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (result.error) throw Error("cloud_browser_preferences_unavailable");
  const row = result.data;
  if (
    row &&
    (!row.settings ||
      typeof row.settings !== "object" ||
      Array.isArray(row.settings) ||
      typeof row.updated_at !== "string")
  )
    throw Error("cloud_browser_preferences_unavailable");
  return row;
}
export async function readCloudBrowserRules(client, ownerId) {
  const row = await readRow(client, ownerId);
  return parseCloudBrowserRules(row?.settings.cloud_browser ?? { sites: [] });
}
export async function saveCloudBrowserRules(client, ownerId, value) {
  const rules = parseCloudBrowserRules(value),
    row = await readRow(client, ownerId);
  const next = {
    user_id: ownerId,
    settings: { ...row?.settings, cloud_browser: rules },
    updated_at: new Date().toISOString(),
  };
  // Compare the complete old JSON as well as its timestamp: another preferences
  // writer may not update updated_at. Never overwrite a concurrent privacy edit.
  const query = row
    ? client
        .from("user_preferences")
        .update(next)
        .eq("user_id", ownerId)
        .eq("updated_at", row.updated_at)
        .eq("settings", JSON.stringify(row.settings))
    : client.from("user_preferences").insert(next);
  const result = await query
    .select("settings")
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (result.error || !result.data) throw Error("cloud_browser_preferences_conflict");
  return parseCloudBrowserRules(result.data.settings.cloud_browser);
}
