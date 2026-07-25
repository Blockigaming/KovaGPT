// Browser-side fetch wrapper that attaches the current Supabase access token
// when browser auth is configured. Anonymous/public API calls must still work
// in preview environments where Supabase client env is intentionally absent.
import { supabase, getSupabaseClientConfigStatus } from "@/integrations/supabase/client";

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (getSupabaseClientConfigStatus().configured) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
