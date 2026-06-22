// Browser-side fetch wrapper that attaches the current Supabase access
// token. Use this for any call to our /api/* routes so the server-side
// auth check can identify the user.
import { supabase } from "@/integrations/supabase/client";

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
