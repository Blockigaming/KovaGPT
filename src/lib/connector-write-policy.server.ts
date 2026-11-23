import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WritableConnector = "gmail" | "google-calendar" | "github" | "onedrive" | "outlook";
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
