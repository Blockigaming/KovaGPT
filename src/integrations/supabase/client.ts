// Browser Supabase client. Sessions are kept in the browser's own localStorage;
// there is no editor/preview session brokerage of any kind.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { PUBLIC_BACKEND_KEY, PUBLIC_BACKEND_URL } from "@/config/public-config";

type BrowserRuntimeEnv = Record<string, string | undefined>;

function readRuntimeEnv(): BrowserRuntimeEnv {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function supabaseUrl(): string | undefined {
  const runtimeEnv = readRuntimeEnv();
  return import.meta.env.VITE_SUPABASE_URL || runtimeEnv.SUPABASE_URL || PUBLIC_BACKEND_URL;
}

function supabasePublishableKey(): string | undefined {
  const runtimeEnv = readRuntimeEnv();
  return (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    runtimeEnv.SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.SUPABASE_ANON_KEY ||
    PUBLIC_BACKEND_KEY
  );
}

export function getSupabaseClientConfigStatus() {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  return {
    configured: Boolean(url && key),
    missing: [
      !url ? "VITE_SUPABASE_URL" : null,
      !key ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
    ].filter(Boolean) as string[],
  };
}

function createSupabaseClient() {
  const SUPABASE_URL = supabaseUrl();
  const SUPABASE_PUBLISHABLE_KEY = supabasePublishableKey();

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = getSupabaseClientConfigStatus().missing;
    const message = `Supabase browser auth is unavailable because deployment configuration is missing: ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Undefined on the server: supabase-js then keeps the session in memory,
      // which is what SSR needs.
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
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
