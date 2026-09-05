// Publishable, non-secret deployment configuration.
//
// These values are safe to ship in the browser bundle (they are the same
// publishable identifiers the client already sends with every request). They
// are committed here so a production build never loses them when local-only
// environment files are absent, which previously made sign-in fail with
// "authentication is not configured".

export const PUBLIC_BACKEND_URL = "https://mfbycmbjygcfkrsuepxf.supabase.co";
export const PUBLIC_BACKEND_KEY = "sb_publishable_3_JjqZc2hdxn2Q0xAWwMOw_EaZsryWw";
export const PUBLIC_BACKEND_PROJECT_ID = "mfbycmbjygcfkrsuepxf";
// Billing has no committed publishable-key fallback. The image build must use
// a public key from the same approved account as its runtime server key.
export const PUBLIC_STRIPE_ACCOUNT_ID = "acct_1UAeDgAEZlsb6DBY";
export const PUBLIC_PAYMENTS_CLIENT_TOKEN = "";
