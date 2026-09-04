/**
 * Truthful auth-provider availability diagnostic.
 *
 * The Supabase Auth `/settings` endpoint is a publishable, browser-safe read
 * that reports which external providers are actually enabled for THIS
 * deployment. We use it so the UI never advertises a provider (e.g. Google)
 * that the deployment cannot complete, and never shows a generic looping
 * failure when the provider is simply not configured.
 *
 * No secrets are involved: only the publishable anon/publishable key is sent.
 */

export type AuthProviderAvailability = {
  /** Provider probe completed and the answer is trustworthy. */
  resolved: boolean;
  /** Enabled external providers reported by the deployment. */
  google: boolean;
  apple: boolean;
  azure: boolean;
  github: boolean;
  /** Email/password + email OTP surface. */
  email: boolean;
  /** Passwordless WebAuthn reported by this deployment. */
  passkeys: boolean;
  /** New signups are accepted at all. */
  signupEnabled: boolean;
  /** Confirmation email is skipped by the deployment (auto-confirm). */
  autoConfirmEmail: boolean;
  /** Set when the probe itself failed; UI must then degrade safely. */
  error?: "unreachable" | "unexpected_response";
};

export const UNRESOLVED_AUTH_PROVIDERS: AuthProviderAvailability = {
  resolved: false,
  google: false,
  apple: false,
  azure: false,
  github: false,
  email: true,
  passkeys: false,
  signupEnabled: true,
  autoConfirmEmail: false,
};

type SettingsPayload = {
  external?: Record<string, unknown>;
  disable_signup?: unknown;
  mailer_autoconfirm?: unknown;
  /** Public GoTrue settings uses plural; singular is a legacy/management compatibility alias. */
  passkeys_enabled?: unknown;
  passkey_enabled?: unknown;
};

function bool(value: unknown): boolean {
  return value === true;
}

export function parseAuthSettings(payload: unknown): AuthProviderAvailability {
  if (!payload || typeof payload !== "object") {
    return { ...UNRESOLVED_AUTH_PROVIDERS, error: "unexpected_response" };
  }
  const data = payload as SettingsPayload;
  const external = data.external && typeof data.external === "object" ? data.external : null;
  if (!external) {
    return { ...UNRESOLVED_AUTH_PROVIDERS, error: "unexpected_response" };
  }
  return {
    resolved: true,
    google: bool(external["google"]),
    apple: bool(external["apple"]),
    azure: bool(external["azure"]),
    github: bool(external["github"]),
    email: bool(external["email"]),
    passkeys: bool(data.passkeys_enabled) || bool(data.passkey_enabled),
    signupEnabled: data.disable_signup !== true,
    autoConfirmEmail: bool(data.mailer_autoconfirm),
  };
}

let cache: { at: number; value: AuthProviderAvailability } | null = null;
let inFlight: Promise<AuthProviderAvailability> | null = null;
const CACHE_MS = 5 * 60_000;

/** Reset the in-memory probe cache. Test-only helper. */
export function resetAuthProviderCache() {
  cache = null;
  inFlight = null;
}

export async function fetchAuthProviderAvailability(
  signal?: AbortSignal,
): Promise<AuthProviderAvailability> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (inFlight) return inFlight;

  const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    import.meta.env["VITE_SUPABASE_ANON_KEY"]) as string | undefined;
  if (!url || !key) {
    return { ...UNRESOLVED_AUTH_PROVIDERS, error: "unreachable" };
  }

  inFlight = (async () => {
    try {
      const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: { apikey: key, Accept: "application/json" },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        return { ...UNRESOLVED_AUTH_PROVIDERS, error: "unreachable" as const };
      }
      const parsed = parseAuthSettings(await response.json());
      if (parsed.resolved) cache = { at: Date.now(), value: parsed };
      return parsed;
    } catch {
      // Never surface a raw provider/network error to the UI.
      return { ...UNRESOLVED_AUTH_PROVIDERS, error: "unreachable" as const };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export const GOOGLE_UNCONFIGURED_MESSAGE =
  "Google sign-in is not configured for this deployment. Use your email address instead.";
