import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtraWriteConnector } from "./connector-write-actions";

export type WritableConnector =
  | "gmail"
  | "google-calendar"
  | "github"
  | "linear"
  | "onedrive"
  | "outlook"
  | "google-drive"
  | "outlook-calendar"
  | "plaid"
  | ExtraWriteConnector;
type Preference = {
  owner_id: string;
  connector: WritableConnector;
  target_id: string;
  allows_write: boolean;
};
const preferences = () =>
  (
    supabaseAdmin as unknown as SupabaseClient<{
      public: {
        Tables: {
          connector_write_preferences: {
            Row: Preference;
            Insert: Preference;
            Update: Partial<Preference>;
            Relationships: [];
          };
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
      };
    }>
  ).from("connector_write_preferences");

export async function connectorWriteAllowed(
  owner: string,
  connector: WritableConnector,
  target: string,
) {
  const { data, error } = await preferences()
    .select("allows_write")
    .eq("owner_id", owner)
    .eq("connector", connector)
    .eq("target_id", target)
    .maybeSingle();
  return !error && data?.allows_write === true;
}

export async function connectorWriteTargets(
  owner: string,
  connector: WritableConnector,
  targets: string[],
) {
  if (targets.length === 0) return new Set<string>();
  const { data, error } = await preferences()
    .select("target_id")
    .eq("owner_id", owner)
    .eq("connector", connector)
    .eq("allows_write", true)
    .in("target_id", targets);
  return new Set(error ? [] : data.map(({ target_id }) => target_id));
}

export async function saveConnectorWritePreference(
  owner: string,
  connector: WritableConnector,
  target: string,
  allowsWrite: boolean,
) {
  const { error } = await preferences().upsert({
    owner_id: owner,
    connector,
    target_id: target,
    allows_write: allowsWrite,
  });
  if (error) throw new Error("Connector permissions could not be saved.");
}
