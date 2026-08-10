// Publishable, non-secret deployment configuration.
//
// Vite replaces the direct import.meta.env references at image-build time. A
// verified staging image therefore compiles its synthetic browser project into
// the bundle, while ordinary production/local builds retain the committed
// browser-safe fallback. The staging verifier rejects a bundle that still
// contains a different project URL or publishable key.

export const PUBLIC_BACKEND_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zrzwkqrwurgutrmvalri.supabase.co";
export const PUBLIC_BACKEND_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_qX2ghqbNW2-TKxk-7ZeR0A_o3uzjipz";
export const PUBLIC_BACKEND_PROJECT_ID = new URL(PUBLIC_BACKEND_URL).hostname.split(".")[0];
export const PUBLIC_PAYMENTS_CLIENT_TOKEN =
  "pk_live_51TW1VcAHcChSIaIorYfT0qVyPHNE8XNhavohT2Rz2ripwYcPkZfmXBAWmhvuBb3UNxP66vntf5TIvgb9wjtjQvCJ009mu2Yl5z";
