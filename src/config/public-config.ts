// Publishable, non-secret deployment configuration.
//
// These values are safe to ship in the browser bundle (they are the same
// publishable identifiers the client already sends with every request).
// Supabase defaults remain committed for authentication continuity. Billing is
// intentionally different: an absent deployment value must fail closed instead
// of silently selecting a publishable key from another Stripe account.

export const PUBLIC_BACKEND_URL = "https://mfbycmbjygcfkrsuepxf.supabase.co";
export const PUBLIC_BACKEND_KEY = "sb_publishable_3_JjqZc2hdxn2Q0xAWwMOw_EaZsryWw";
export const PUBLIC_BACKEND_PROJECT_ID = "mfbycmbjygcfkrsuepxf";
// Billing intentionally has no committed publishable-key fallback. Deployment
// must inject the key for the same approved account as the live server key.
export const PUBLIC_STRIPE_ACCOUNT_ID = "acct_1UAeDgAEZlsb6DBY";
export const PUBLIC_PAYMENTS_CLIENT_TOKEN = "";
