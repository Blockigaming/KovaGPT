import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { safeRelativeRedirect } from "@/lib/auth-security.mjs";

export const OAUTH_CALLBACK_PATH = "/~oauth/callback";
export const POST_AUTH_REDIRECT_KEY = "kovagpt:post-auth-redirect";
export const POST_AUTH_REDIRECT_PARAM = "return_to";
export const PASSWORD_RECOVERY_KEY = "kovagpt:password-recovery-started";
const PASSWORD_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;

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
    // The reset route also listens for Supabase's PASSWORD_RECOVERY event.
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

async function waitForStoredSession(candidate: Session | null): Promise<Session | null> {
  if (candidate?.access_token && candidate.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: candidate.access_token,
      refresh_token: candidate.refresh_token,
    });
    if (error) {
      console.error("[KovaAuth] Session persistence failed after OAuth.", {
        error: authErrorKind(error),
      });
      throw error;
    }
  }

  for (let i = 0; i < 20; i += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[KovaAuth] Session read failed after OAuth.", {
        error: authErrorKind(error),
      });
      throw error;
    }
    if (data.session?.access_token) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        console.error("[KovaAuth] Current user check failed after OAuth.", {
          error: authErrorKind(userError),
        });
        throw userError ?? new Error("No current user was found after Google sign in.");
      }
      return data.session;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

export async function completeOAuthSessionFromUrl(source: string): Promise<Session | null> {
  const url = getCurrentUrl();
  if (!url) return null;

  const oauthError = getOAuthParam(url, "error");
  if (oauthError) {
    console.error(`[KovaAuth] OAuth callback error from ${source}.`, {
      error: oauthError.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "provider_error",
    });
    throw new Error("Google sign in failed.");
  }

  // Implicit-flow credentials belong in the fragment. Never consume tokens
  // from the query string, where servers, proxies, analytics, and referrers may
  // record them.
  const hash = getHashParams(url);
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error(`[KovaAuth] OAuth token session save failed from ${source}.`, {
        error: authErrorKind(error),
      });
      throw error;
    }
    return waitForStoredSession(data.session ?? null);
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error(`[KovaAuth] OAuth code exchange failed from ${source}.`, {
        error: authErrorKind(error),
      });
      throw error;
    }
    return waitForStoredSession(data.session ?? null);
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error(`[KovaAuth] Session lookup failed from ${source}.`, {
      error: authErrorKind(error),
    });
    throw error;
  }
  return waitForStoredSession(data.session ?? null);
}
