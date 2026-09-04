// Browser Supabase client. Sessions are kept in the browser's own localStorage;
// there is no editor/preview session brokerage of any kind.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { SUPABASE_BROWSER_CONFIG } from "./config";

export function getSupabaseClientConfigStatus() {
  const { url, publishableKey } = SUPABASE_BROWSER_CONFIG;
  return {
    configured: Boolean(url && publishableKey),
    missing: [
      !url ? "VITE_SUPABASE_URL" : null,
      !publishableKey ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
    ].filter(Boolean) as string[],
  };
}

function createSupabaseClient() {
  const { url, publishableKey } = SUPABASE_BROWSER_CONFIG;

  if (!url || !publishableKey) {
    const missing = [
      !url ? "VITE_SUPABASE_URL" : null,
      !publishableKey ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
    ].filter(Boolean);
    const message = `Supabase browser auth is unavailable because deployment configuration is missing: ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(url, publishableKey, {
    auth: {
      // Undefined on the server: supabase-js then keeps the session in memory,
      // which is what SSR needs.
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      // Required by supabase-js for the experimental WebAuthn passkey API.
      // The UI still verifies /auth/v1/settings before advertising support.
      experimental: { passkey: true },
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
