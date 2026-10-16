import type { Session } from "@supabase/supabase-js";
import { resolveLegacyAuthContext } from "@/integrations/supabase/client";
import { safeRelativeRedirect } from "@/lib/auth-security.mjs";

export const OAUTH_CALLBACK_PATH = "/~oauth/callback";
export const POST_AUTH_REDIRECT_KEY = "kovagpt:post-auth-redirect";
export const POST_AUTH_REDIRECT_PARAM = "return_to";
export const PASSWORD_RECOVERY_KEY = "kovagpt:password-recovery-started";
const PASSWORD_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;

// Opt-in, tab-local diagnostics. This records classifications, never a URL,
// address, identity, token, provider message or request/response body.
const DIAGNOSTIC_KEY = "kovagpt:hosted-auth-diagnostic:v1";
const DIAGNOSTIC_OPT_IN_KEY = "kovagpt:hosted-auth-diagnostic-enabled:v1";
const DIAGNOSTIC_TTL_MS = 30 * 60 * 1000;
const DIAGNOSTIC_PHASES = [
  "email_request",
  "callback_received",
  "authority",
  "fragment_scrub",
  "session_write",
  "code_exchange",
  "session_read",
  "current_user",
  "provider_user",
  "provider_assurance",
  "ui_validation",
  "ui_session",
  "callback_finish",
  "logout",
] as const;
type DiagnosticPhase = (typeof DIAGNOSTIC_PHASES)[number];
type DiagnosticOutcome =
  | "started"
  | "ok"
  | "error"
  | "cancelled"
  | "missing"
  | "mismatch"
  | "guest"
  | "authenticated"
  | "mfa_required"
  | "timeout";
type DiagnosticDetails = {
  error?: unknown;
  elapsedMs?: number;
  sessionPresent?: boolean;
  identityMatches?: boolean;
  flow?: "implicit" | "pkce" | "provider_error" | "none";
  origin?: "canonical" | "www" | "other";
  route?: "callback" | "root" | "other";
  queryCredentialsPresent?: boolean;
  redirectOriginChanges?: boolean;
};
type DiagnosticEvent = Record<string, string | number | boolean | null>;
let diagnostic: { startedAt: number; events: DiagnosticEvent[] } | null = null;

function diagnosticActive(): boolean {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  if (!diagnostic) {
    // Validate persisted state before making even a sanitized copy visible.
    try {
      const saved = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_KEY) ?? "null");
      if (
        saved &&
        Number.isFinite(saved.startedAt) &&
        now >= saved.startedAt &&
        now - saved.startedAt < DIAGNOSTIC_TTL_MS &&
        Array.isArray(saved.events)
      ) {
        diagnostic = {
          startedAt: saved.startedAt,
          events: saved.events.slice(-64).map(sanitizeDiagnosticEvent),
        };
      }
    } catch {
      /* In-memory diagnostics still work when storage is unavailable. */
    }
    let enabledAt = 0;
    try {
      enabledAt = Number(window.localStorage.getItem(DIAGNOSTIC_OPT_IN_KEY));
    } catch {
      /* optional */
    }
    if (getCurrentUrl()?.searchParams.get("auth_debug") === "1") {
      enabledAt = now;
      // Only the expiring opt-in crosses tabs; no auth data or diagnostic events.
      try {
        window.localStorage.setItem(DIAGNOSTIC_OPT_IN_KEY, String(now));
      } catch {
        /* optional */
      }
    }
    if (!diagnostic && enabledAt > 0 && now >= enabledAt && now - enabledAt < DIAGNOSTIC_TTL_MS) {
      diagnostic = { startedAt: now, events: [] };
    }
  }
  return Boolean(
    diagnostic && now >= diagnostic.startedAt && now - diagnostic.startedAt < DIAGNOSTIC_TTL_MS,
  );
}

function sanitizeDiagnosticEvent(raw: unknown): DiagnosticEvent {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const output: DiagnosticEvent = {};
  const enums: Record<string, readonly string[]> = {
    phase: DIAGNOSTIC_PHASES,
    outcome: [
      "started",
      "ok",
      "error",
      "cancelled",
      "missing",
      "mismatch",
      "guest",
      "authenticated",
      "mfa_required",
      "timeout",
    ],
    errorClass: [
      "AbortError",
      "AuthApiError",
      "AuthRetryableFetchError",
      "AuthSessionMissingError",
      "AuthInvalidTokenResponseError",
      "AuthUnknownError",
      "HostedAuthCallbackError",
      "TypeError",
      "Error",
      "other",
    ],
    code: [
      "otp_expired",
      "provider_rejected",
      "session_not_found",
      "refresh_token_not_found",
      "bad_jwt",
      "over_request_rate_limit",
      "other",
    ],
    flow: ["implicit", "pkce", "provider_error", "none"],
    origin: ["canonical", "www", "other"],
    route: ["callback", "root", "other"],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (typeof input[key] === "string" && allowed.includes(input[key])) output[key] = input[key];
  }
  for (const key of ["elapsedMs", "sinceStartMs"]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value))
      output[key] = Math.min(DIAGNOSTIC_TTL_MS, Math.max(0, Math.round(value)));
  }
  const status = input.httpStatus;
  output.httpStatus =
    typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
  for (const key of [
    "sessionPresent",
    "identityMatches",
    "queryCredentialsPresent",
    "redirectOriginChanges",
  ]) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  return output;
}

export function recordHostedAuthDiagnostic(
  phase: DiagnosticPhase,
  outcome: DiagnosticOutcome,
  details: DiagnosticDetails = {},
) {
  // Diagnostics must never change the authentication outcome, even if saving
  // or console capture fails. The memory buffer survives failed storage writes.
  try {
    if (!diagnosticActive() || !diagnostic) return;
    const error =
      details.error && typeof details.error === "object"
        ? (details.error as Record<string, unknown>)
        : null;
    const event = sanitizeDiagnosticEvent({
      ...details,
      phase,
      outcome,
      sinceStartMs: Date.now() - diagnostic.startedAt,
      httpStatus: error?.status,
      ...(error
        ? {
            errorClass:
              typeof error.name === "string" &&
              [
                "AbortError",
                "AuthApiError",
                "AuthRetryableFetchError",
                "AuthSessionMissingError",
                "AuthInvalidTokenResponseError",
                "AuthUnknownError",
                "HostedAuthCallbackError",
                "TypeError",
                "Error",
              ].includes(error.name)
                ? error.name
                : "other",
            code:
              typeof error.code === "string" &&
              [
                "otp_expired",
                "provider_rejected",
                "session_not_found",
                "refresh_token_not_found",
                "bad_jwt",
                "over_request_rate_limit",
              ].includes(error.code)
                ? error.code
                : "other",
          }
        : {}),
    });
    diagnostic.events.push(event);
    diagnostic.events = diagnostic.events.slice(-64);
    try {
      sessionStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify(diagnostic));
    } catch {
      /* memory retained */
    }
    try {
      console.info("[KovaAuth diagnostic]", event);
    } catch {
      /* no auth impact */
    }
  } catch {
    /* no auth impact */
  }
}

export function getHostedAuthDiagnosticText(): string | null {
  if (!diagnosticActive() || !diagnostic) return null;
  return JSON.stringify(
    {
      kind: "SANITIZED_BROWSER_AUTH_DIAGNOSTIC",
      httpStatusMeaning: "SDK-reported error status only; null means not observed",
      events: diagnostic.events,
    },
    null,
    2,
  );
}

export async function traceHostedAuth<T>(
  phase: DiagnosticPhase,
  operation: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  recordHostedAuthDiagnostic(phase, "started");
  try {
    const result = await operation();
    const error = result && typeof result === "object" && "error" in result ? result.error : null;
    recordHostedAuthDiagnostic(phase, error ? "error" : "ok", {
      elapsedMs: Date.now() - start,
      error,
    });
    return result;
  } catch (error) {
    recordHostedAuthDiagnostic(
      phase,
      error instanceof Error && error.name === "AbortError" ? "cancelled" : "error",
      { elapsedMs: Date.now() - start, error },
    );
    throw error;
  }
}

export const UNUSABLE_SIGN_IN_LINK_MESSAGE =
  "This sign-in link has expired or was already used. Request a new link and open it once in the browser you want to use.";

export class HostedAuthCallbackError extends Error {
  readonly code: "otp_expired" | "provider_rejected";

  constructor(providerCode: string | null) {
    const code = providerCode === "otp_expired" ? "otp_expired" : "provider_rejected";
    super(
      code === "otp_expired"
        ? UNUSABLE_SIGN_IN_LINK_MESSAGE
        : "Sign in could not be completed. Please try again.",
    );
    this.name = "HostedAuthCallbackError";
    this.code = code;
  }
}

export function isUnusableHostedAuthLink(error: unknown): boolean {
  return error instanceof HostedAuthCallbackError && error.code === "otp_expired";
}

function getCurrentUrl(): URL | null {
  if (typeof window === "undefined") return null;
  try {
    return new URL(window.location.href);
  } catch {
    return null;
  }
}

function getHashParams(url: URL): URLSearchParams {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash);
}

function getOAuthParam(url: URL, key: string): string | null {
  return url.searchParams.get(key) || getHashParams(url).get(key);
}

function authErrorKind(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown_error";
}

export function getOAuthRedirectUri(): string {
  if (typeof window === "undefined") return `https://kovagpt.com${OAUTH_CALLBACK_PATH}`;

  const host = window.location.hostname.toLowerCase();
  if (host === "kovagpt.com" || host === "www.kovagpt.com") {
    return `https://kovagpt.com${OAUTH_CALLBACK_PATH}`;
  }

  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

function readRememberedPostAuthRedirect(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
  } catch (error) {
    console.error("[KovaAuth] Could not read post sign in destination.", {
      error: authErrorKind(error),
    });
    return null;
  }
}

export function rememberPostAuthRedirect() {
  if (typeof window === "undefined") return;
  try {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!path || path.startsWith(OAUTH_CALLBACK_PATH)) return;
    sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
  } catch (error) {
    console.error("[KovaAuth] Could not save post sign in destination.", {
      error: authErrorKind(error),
    });
  }
}

export function getEmailAuthRedirectUri(): string {
  const callback = new URL(getOAuthRedirectUri());
  const baseOrigin = typeof window === "undefined" ? callback.origin : window.location.origin;
  const next = safeRelativeRedirect(
    readRememberedPostAuthRedirect(),
    baseOrigin,
    OAUTH_CALLBACK_PATH,
  );
  callback.searchParams.set(POST_AUTH_REDIRECT_PARAM, next);
  return callback.toString();
}

export function getCallbackPostAuthRedirect(): string | null {
  const url = getCurrentUrl();
  return url?.pathname === OAUTH_CALLBACK_PATH
    ? url.searchParams.get(POST_AUTH_REDIRECT_PARAM)
    : null;
}

export function getSafePostAuthRedirect(callbackRedirect?: string | null): string {
  if (typeof window === "undefined") return "/";
  const remembered = readRememberedPostAuthRedirect();
  try {
    sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
  } catch (error) {
    console.error("[KovaAuth] Could not clear post sign in destination.", {
      error: authErrorKind(error),
    });
  }
  return safeRelativeRedirect(
    callbackRedirect ?? remembered,
    window.location.origin,
    OAUTH_CALLBACK_PATH,
  );
}

export function markPasswordRecoveryFlow(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    sessionStorage.setItem(
      PASSWORD_RECOVERY_KEY,
      JSON.stringify({ userId, startedAt: Date.now() }),
    );
  } catch {
    // The explicit recovery callback remains usable within the current view.
  }
}

export function hasRecentPasswordRecoveryFlow(userId: string) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const raw = sessionStorage.getItem(PASSWORD_RECOVERY_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as { userId?: unknown; startedAt?: unknown };
    return (
      marker.userId === userId &&
      typeof marker.startedAt === "number" &&
      Number.isFinite(marker.startedAt) &&
      Date.now() >= marker.startedAt &&
      Date.now() - marker.startedAt <= PASSWORD_RECOVERY_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

export function clearPasswordRecoveryFlow() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
  } catch {
    // No persistent marker remains when browser storage is unavailable.
  }
}

export function hasOAuthResponseInUrl(): boolean {
  const url = getCurrentUrl();
  if (!url) return false;
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("access_token") ||
    url.searchParams.has("refresh_token") ||
    !!getOAuthParam(url, "access_token") ||
    !!getOAuthParam(url, "refresh_token") ||
    !!getOAuthParam(url, "error")
  );
}

export function clearOAuthResponseFromUrl() {
  if (typeof window === "undefined") return;
  const url = getCurrentUrl();
  if (!url) return;

  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  url.searchParams.delete("state");
  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("expires_in");
  url.searchParams.delete("expires_at");
  url.searchParams.delete("provider_token");
  url.searchParams.delete("provider_refresh_token");
  url.searchParams.delete("token_type");
  url.searchParams.delete("type");
  url.searchParams.delete(POST_AUTH_REDIRECT_PARAM);
  url.hash = "";

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function waitForStoredSession(
  candidate: Session | null,
  context: Awaited<ReturnType<typeof resolveLegacyAuthContext>>,
  assertCurrent: () => void,
): Promise<Session | null> {
  assertCurrent();
  // setSession/exchangeCodeForSession already persist in auth-js. Read that
  // result back and validate it; writing again repeats /user and SIGNED_IN.

  for (let i = 0; i < 20; i += 1) {
    assertCurrent();
    const { data, error } = await traceHostedAuth("session_read", () => context.auth.getSession());
    assertCurrent();
    if (error) {
      console.error("[KovaAuth] Session read failed after OAuth.", {
        error: authErrorKind(error),
      });
      throw error;
    }
    if (data.session?.access_token) {
      const { data: userData, error: userError } = await traceHostedAuth("current_user", () =>
        context.auth.getUser(),
      );
      assertCurrent();
      recordHostedAuthDiagnostic(
        "current_user",
        userError
          ? "error"
          : !userData.user
            ? "missing"
            : userData.user.id === data.session.user.id &&
                (!candidate || data.session.user.id === candidate.user.id)
              ? "ok"
              : "mismatch",
        {
          error: userError,
          sessionPresent: true,
          identityMatches: Boolean(
            userData.user &&
            userData.user.id === data.session.user.id &&
            (!candidate || data.session.user.id === candidate.user.id),
          ),
        },
      );
      if (
        userError ||
        !userData.user ||
        userData.user.id !== data.session.user.id ||
        (candidate && data.session.user.id !== candidate.user.id)
      ) {
        console.error("[KovaAuth] Current user check failed after OAuth.", {
          error: authErrorKind(userError),
        });
        throw userError ?? new Error("No matching current user was found after sign in.");
      }
      return data.session;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

export async function completeOAuthSessionFromUrl(
  source: string,
  signal?: AbortSignal,
  options: { recoveryOnly?: boolean } = {},
): Promise<Session | null> {
  const url = getCurrentUrl();
  if (!url) return null;
  const fragment = getHashParams(url);
  recordHostedAuthDiagnostic("callback_received", "ok", {
    flow: getOAuthParam(url, "error")
      ? "provider_error"
      : fragment.has("access_token") && fragment.has("refresh_token")
        ? "implicit"
        : url.searchParams.has("code")
          ? "pkce"
          : "none",
    origin:
      url.hostname === "kovagpt.com"
        ? "canonical"
        : url.hostname === "www.kovagpt.com"
          ? "www"
          : "other",
    route:
      url.pathname === OAUTH_CALLBACK_PATH ? "callback" : url.pathname === "/" ? "root" : "other",
    queryCredentialsPresent:
      url.searchParams.has("access_token") || url.searchParams.has("refresh_token"),
    redirectOriginChanges: new URL(getOAuthRedirectUri()).origin !== url.origin,
  });
  // Clear before any network operation, including failed or forbidden callbacks.
  clearOAuthResponseFromUrl();
  recordHostedAuthDiagnostic("fragment_scrub", "ok");
  signal?.throwIfAborted();
  const context = await traceHostedAuth("authority", () => resolveLegacyAuthContext());
  const assertCurrent = () => {
    signal?.throwIfAborted();
    context.assertCurrent();
  };
  assertCurrent();

  const oauthError = getOAuthParam(url, "error");
  if (oauthError) {
    // Callback parameters are untrusted. Preserve only an allowlisted reason,
    // never provider descriptions, arbitrary codes, URLs or credentials.
    const failure = new HostedAuthCallbackError(getOAuthParam(url, "error_code"));
    console.error(`[KovaAuth] OAuth callback error from ${source}.`, {
      error: failure.code,
    });
    throw failure;
  }

  // Implicit-flow credentials belong in the fragment. Never consume tokens
  // from the query string, where servers, proxies, analytics, and referrers may
  // record them.
  const hash = getHashParams(url);
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    if (options.recoveryOnly && hash.get("type") !== "recovery")
      throw new Error("password_recovery_proof_required");
    const { data, error } = await traceHostedAuth("session_write", () =>
      context.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
    );
    assertCurrent();
    if (error) {
      console.error(`[KovaAuth] OAuth token session save failed from ${source}.`, {
        error: authErrorKind(error),
      });
      throw error;
    }
    const restored = await waitForStoredSession(data.session ?? null, context, assertCurrent);
    assertCurrent();
    if (restored && hash.get("type") === "recovery") markPasswordRecoveryFlow(restored.user.id);
    return restored;
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await traceHostedAuth("code_exchange", () =>
      context.auth.exchangeCodeForSession(code),
    );
    assertCurrent();
    if (error) {
      console.error(`[KovaAuth] OAuth code exchange failed from ${source}.`, {
        error: authErrorKind(error),
      });
      throw error;
    }
    // auth-js binds redirectType to its stored PKCE verifier, not a query flag.
    // The pinned SDK returns this field at runtime but omits it from its public
    // AuthTokenResponse type. Treat an absent/changed field as no recovery proof.
    const redirectType = (data as typeof data & { redirectType?: unknown }).redirectType;
    if (options.recoveryOnly && redirectType !== "recovery")
      throw new Error("password_recovery_proof_required");
    const restored = await waitForStoredSession(data.session ?? null, context, assertCurrent);
    assertCurrent();
    if (restored && redirectType === "recovery") markPasswordRecoveryFlow(restored.user.id);
    return restored;
  }

  const { data, error } = await traceHostedAuth("session_read", () => context.auth.getSession());
  assertCurrent();
  if (error) {
    console.error(`[KovaAuth] Session lookup failed from ${source}.`, {
      error: authErrorKind(error),
    });
    throw error;
  }
  const restored = await waitForStoredSession(data.session ?? null, context, assertCurrent);
  assertCurrent();
  if (options.recoveryOnly && (!restored || !hasRecentPasswordRecoveryFlow(restored.user.id)))
    throw new Error("password_recovery_proof_required");
  return restored;
}
