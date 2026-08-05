// Publishable, non-secret deployment configuration.
//
// These values are safe to ship in the browser bundle (they are the same
// publishable identifiers the client already sends with every request). They
// are committed here so a production build never loses them when local-only
// environment files are absent, which previously made sign-in fail with
// "authentication is not configured".

export const PUBLIC_BACKEND_URL = "https://zrzwkqrwurgutrmvalri.supabase.co";
export const PUBLIC_BACKEND_KEY = "sb_publishable_qX2ghqbNW2-TKxk-7ZeR0A_o3uzjipz";
export const PUBLIC_BACKEND_PROJECT_ID = "zrzwkqrwurgutrmvalri";
export const PUBLIC_PAYMENTS_CLIENT_TOKEN =
  "pk_live_51TW1VcAHcChSIaIorYfT0qVyPHNE8XNhavohT2Rz2ripwYcPkZfmXBAWmhvuBb3UNxP66vntf5TIvgb9wjtjQvCJ009mu2Yl5z";
