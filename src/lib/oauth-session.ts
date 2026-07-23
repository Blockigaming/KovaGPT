import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const OAUTH_CALLBACK_PATH = "/~oauth/callback";
export const POST_AUTH_REDIRECT_KEY = "kovagpt:post-auth-redirect";

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

export function getOAuthRedirectUri(): string {
  if (typeof window === "undefined") return "https://kovagpt.com/";

  const host = window.location.hostname.toLowerCase();
  if (host === "kovagpt.com" || host === "www.kovagpt.com") {
    return "https://kovagpt.com/";
  }

  return `${window.location.origin}/`;
}

export function rememberPostAuthRedirect() {
  if (typeof window === "undefined") return;
  try {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!path || path.startsWith(OAUTH_CALLBACK_PATH)) return;
    sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
  } catch (error) {
    console.error("[KovaAuth] Could not save post sign in destination.", error);
  }
}

export function getSafePostAuthRedirect(): string {
  if (typeof window === "undefined") return "/";
  try {
    const stored = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
    sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    if (!stored) return "/";
    if (!stored.startsWith("/") || stored.startsWith("//")) return "/";
    if (stored.startsWith(OAUTH_CALLBACK_PATH)) return "/";
    return stored;
  } catch (error) {
    console.error("[KovaAuth] Could not read post sign in destination.", error);
    return "/";
  }
}

export function hasOAuthResponseInUrl(): boolean {
  const url = getCurrentUrl();
  if (!url) return false;
  return (
    url.searchParams.has("code") ||
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
      console.error("[KovaAuth] Session persistence failed after OAuth.", error);
      throw error;
    }
  }

  for (let i = 0; i < 20; i += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[KovaAuth] Session read failed after OAuth.", error);
      throw error;
    }
    if (data.session?.access_token) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        console.error("[KovaAuth] Current user check failed after OAuth.", userError);
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
    const description = getOAuthParam(url, "error_description") || "Google sign in failed.";
    const error = new Error(description);
    console.error(`[KovaAuth] OAuth callback error from ${source}.`, error);
    throw error;
  }

  const accessToken = getOAuthParam(url, "access_token");
  const refreshToken = getOAuthParam(url, "refresh_token");
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error(`[KovaAuth] OAuth token session save failed from ${source}.`, error);
      throw error;
    }
    return waitForStoredSession(data.session ?? null);
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error(`[KovaAuth] OAuth code exchange failed from ${source}.`, error);
      throw error;
    }
    return waitForStoredSession(data.session ?? null);
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error(`[KovaAuth] Session lookup failed from ${source}.`, error);
    throw error;
  }
  return waitForStoredSession(data.session ?? null);
}
