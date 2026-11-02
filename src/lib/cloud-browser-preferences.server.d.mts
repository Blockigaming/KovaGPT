import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudBrowserRules } from "./cloud-browser-rules.mjs";
export function readCloudBrowserRules(
  client: SupabaseClient,
  ownerId: string,
): Promise<CloudBrowserRules>;
export function saveCloudBrowserRules(
  client: SupabaseClient,
  ownerId: string,
  value: unknown,
): Promise<CloudBrowserRules>;
