import { PUBLIC_BACKEND_KEY, PUBLIC_BACKEND_URL } from "@/config/public-config";

// Keep browser configuration build-time-only so SSR provenance and the hydrated
// client use the same immutable values. Server-only SUPABASE_* variables belong
// to server integrations and must not alter this public browser configuration.
export const SUPABASE_BROWSER_CONFIG = Object.freeze({
  url: import.meta.env.VITE_SUPABASE_URL || PUBLIC_BACKEND_URL,
  publishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    PUBLIC_BACKEND_KEY,
});
