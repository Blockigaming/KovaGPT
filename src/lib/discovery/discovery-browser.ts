import { supabase } from "@/integrations/supabase/client";
import { requestDiscovery } from "./discovery-client.mjs";
export function discoveryApiRequest(owner: string, signal: AbortSignal, body?: unknown) {
  return requestDiscovery({ owner, signal, body, getSession: () => supabase.auth.getSession() });
}
