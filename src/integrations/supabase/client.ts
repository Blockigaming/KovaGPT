// Browser Supabase client. Sessions are kept in the browser's own localStorage;
// there is no editor/preview session brokerage of any kind.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { SUPABASE_BROWSER_CONFIG } from "./config";
import {
  browserKovaAuthMode,
  getCachedKovaSession,
  getKovaCompatibilityToken,
  isKovaSessionActive,
  setKovaSessionActive,
  kovaAuthGeneration,
  resolveKovaSessionAuthority,
  kovaPublicAuthJson,
  announceKovaAuthChange,
} from "@/lib/kova-auth-browser";
import type { Session, User } from "@supabase/supabase-js";
import { createKovaDataFetch } from "@/lib/kova-auth-data-fetch";

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

function createSupabaseClient(kind: "legacy" | "kova") {
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

  if (kind === "kova") {
    // Supabase remains the data plane during this migration. A short-lived
    // Kova-signed JWT supplies the stable UUID to RLS, while the authoritative
    // browser credential stays in the HttpOnly Kova session cookie.
    return createClient<Database>(url, publishableKey, {
      accessToken: getKovaCompatibilityToken,
      global: { fetch: createKovaDataFetch(url) },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return createClient<Database>(url, publishableKey, {
    auth: {
      // Undefined on the server: supabase-js then keeps the session in memory,
      // which is what SSR needs.
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      // The callback handler owns the single exchange after authority selection.
      // Do not let SDK initialization race it or consume a returning URL early.
      detectSessionInUrl: false,
      // Required by supabase-js for the experimental WebAuthn passkey API.
      // The UI still verifies /auth/v1/settings before advertising support.
      experimental: { passkey: true },
    },
  });
}

let _legacySupabase: ReturnType<typeof createSupabaseClient> | undefined;
let _kovaSupabase: ReturnType<typeof createSupabaseClient> | undefined;

export async function resolveLegacyAuthContext() {
  const mode = browserKovaAuthMode();
  if (mode === "kova") throw new Error("hosted_auth_unavailable");
  if (mode === "dual") {
    const principal = await resolveKovaSessionAuthority();
    if (principal || isKovaSessionActive()) throw new Error("hosted_auth_unavailable");
  }
  const generation = kovaAuthGeneration();
  const assertCurrent = () => {
    if (
      browserKovaAuthMode() !== mode ||
      isKovaSessionActive() ||
      kovaAuthGeneration() !== generation
    ) {
      throw new Error("auth_authority_changed");
    }
  };
  assertCurrent();
  if (!_legacySupabase) _legacySupabase = createSupabaseClient("legacy");
  return { auth: _legacySupabase.auth, assertCurrent };
}

export async function signOutLegacySupabaseSession() {
  if (!_legacySupabase) _legacySupabase = createSupabaseClient("legacy");
  return _legacySupabase.auth.signOut({ scope: "local" });
}

function activeSupabaseClient() {
  if (isKovaSessionActive()) {
    if (!_kovaSupabase) _kovaSupabase = createSupabaseClient("kova");
    return _kovaSupabase;
  }
  if (!_legacySupabase) _legacySupabase = createSupabaseClient("legacy");
  return _legacySupabase;
}

async function kovaSession(): Promise<Session | null> {
  const principal = await getCachedKovaSession();
  if (!principal) return null;
  const accessToken = await getKovaCompatibilityToken();
  if (!accessToken) return null;
  const confirmedAt = principal.emailVerified ? new Date().toISOString() : undefined;
  const user = {
    id: principal.accountId,
    aud: "authenticated",
    role: "authenticated",
    email: principal.email,
    email_confirmed_at: confirmedAt,
    confirmed_at: confirmedAt,
    app_metadata: { provider: "kova", providers: ["kova"] },
    user_metadata: principal.displayName ? { full_name: principal.displayName } : {},
    identities: [],
    created_at: "",
    updated_at: "",
  } as User;
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  return {
    access_token: accessToken,
    refresh_token: "",
    token_type: "bearer",
    expires_in: 300,
    expires_at: expiresAt,
    user,
  };
}

const unsupportedKovaAuth = async () => ({
  data: null,
  error: new Error("This hosted-auth operation is unavailable for a Kova-owned session."),
});

const kovaAuth = {
  getSession: async () => ({ data: { session: await kovaSession() }, error: null }),
  getUser: async () => {
    const session = await kovaSession();
    return { data: { user: session?.user ?? null }, error: null };
  },
  getClaims: async () => {
    const session = await kovaSession();
    if (!session) return { data: null, error: new Error("No Kova session") };
    const payload = session.access_token.split(".")[1];
    try {
      const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return { data: { claims: JSON.parse(atob(padded)) }, error: null };
    } catch {
      return { data: null, error: new Error("Invalid Kova compatibility token") };
    }
  },
  onAuthStateChange: () => ({
    data: { subscription: { id: "kova-auth", callback: () => {}, unsubscribe: () => {} } },
  }),
  signOut: async () => {
    if (browserKovaAuthMode() === "dual") {
      const legacyResult = await signOutLegacySupabaseSession();
      if (legacyResult.error) return legacyResult;
    }
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) return { error: new Error("Kova sign out failed") };
    // Clear the short-lived compatibility-token cache even in pure Kova mode.
    setKovaSessionActive(false);
    if (browserKovaAuthMode() === "kova") setKovaSessionActive(true);
    announceKovaAuthChange();
    return { error: null };
  },
  setSession: unsupportedKovaAuth,
  updateUser: unsupportedKovaAuth,
  resetPasswordForEmail: unsupportedKovaAuth,
  signUp: unsupportedKovaAuth,
  signInWithPassword: unsupportedKovaAuth,
  signInWithOtp: unsupportedKovaAuth,
  signInWithOAuth: unsupportedKovaAuth,
  signInWithPasskey: unsupportedKovaAuth,
  resend: async (input: { type?: string; email?: string }) => {
    if (input?.type !== "signup" || typeof input.email !== "string") return unsupportedKovaAuth();
    try {
      const response = await kovaPublicAuthJson("/api/auth/verify/resend", { email: input.email });
      return { data: null, error: response.ok ? null : new Error("Verification request failed") };
    } catch {
      return { data: null, error: new Error("Verification request failed") };
    }
  },
  mfa: {
    getAuthenticatorAssuranceLevel: async () => ({
      data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] },
      error: null,
    }),
    listFactors: async () => ({ data: { all: [], totp: [], phone: [] }, error: null }),
    enroll: unsupportedKovaAuth,
    challenge: unsupportedKovaAuth,
    verify: unsupportedKovaAuth,
    challengeAndVerify: unsupportedKovaAuth,
    unenroll: unsupportedKovaAuth,
  },
  passkey: {
    list: async () => ({ data: [], error: null }),
    register: unsupportedKovaAuth,
    update: unsupportedKovaAuth,
    delete: unsupportedKovaAuth,
  },
};

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (prop === "auth" && isKovaSessionActive()) return kovaAuth;
    return Reflect.get(activeSupabaseClient(), prop, receiver);
  },
});
