export type KovaBrowserPrincipal = {
  accountId: string;
  sessionId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  assuranceLevel: "aal1" | "aal2";
  expiresAt: string;
};

type TokenCache = { token: string; refreshAt: number } | null;
type PrincipalCache = { principal: KovaBrowserPrincipal | null; refreshAt: number } | null;

export class KovaSessionRejectedError extends Error {
  constructor() {
    super("kova_session_rejected");
    this.name = "KovaSessionRejectedError";
  }
}

export function isKovaSessionRejectedError(value: unknown): value is KovaSessionRejectedError {
  return value instanceof KovaSessionRejectedError;
}

let tokenCache: TokenCache = null;
let principalCache: PrincipalCache = null;
let cacheGeneration = 0;
const authorityListeners = new Set<() => void>();
export function subscribeKovaAuthChanges(listener: () => void): () => void {
  authorityListeners.add(listener);
  return () => {
    authorityListeners.delete(listener);
  };
}
// In dual mode, hold direct Supabase access on the Kova path until the
// HttpOnly-cookie probe proves that the browser has no Kova session. This
// prevents a stale legacy localStorage token from briefly loading a different
// account while the preferred Kova principal is still unresolved.
let kovaSessionActive =
  import.meta.env.VITE_KOVA_AUTH_MODE === "kova" || import.meta.env.VITE_KOVA_AUTH_MODE === "dual";

export function browserKovaAuthMode(): "supabase" | "dual" | "kova" {
  const value = import.meta.env.VITE_KOVA_AUTH_MODE;
  if (!value || value === "supabase") return "supabase";
  if (value === "dual" || value === "kova") return value;
  throw new Error("Invalid VITE_KOVA_AUTH_MODE");
}

export function browserKovaAuthEnabled(): boolean {
  return browserKovaAuthMode() !== "supabase";
}

export function browserKovaAuthOrigin(currentOrigin = window.location.origin): string {
  const configured = import.meta.env.VITE_KOVA_AUTH_ORIGIN;
  if (!configured) return currentOrigin;
  const parsed = new URL(configured);
  if (parsed.protocol !== "https:" || parsed.origin !== configured) {
    throw new Error("VITE_KOVA_AUTH_ORIGIN must be an exact HTTPS origin");
  }
  return parsed.origin;
}

export function setKovaSessionActive(active: boolean): void {
  if (active === kovaSessionActive) return;
  kovaSessionActive = active;
  clearKovaAuthCache();
}

export function kovaAuthGeneration(): number {
  return cacheGeneration;
}

let authorityProbe: { generation: number; promise: Promise<KovaBrowserPrincipal | null> } | null =
  null;

// Share the initial cookie probe between the provider and a returning hosted
// callback. Neither may temporarily choose legacy authority before it finishes.
export function resolveKovaSessionAuthority(): Promise<KovaBrowserPrincipal | null> {
  if (authorityProbe?.generation === cacheGeneration) return authorityProbe.promise;
  const generation = cacheGeneration;
  const promise = fetchKovaSession().then((principal) => {
    if (generation !== cacheGeneration) throw new Error("kova_session_changed");
    setKovaSessionActive(Boolean(principal) || browserKovaAuthMode() === "kova");
    return principal;
  });
  const probe = { generation, promise };
  authorityProbe = probe;
  void promise.then(
    () => {
      if (authorityProbe === probe) authorityProbe = null;
    },
    () => {
      if (authorityProbe === probe) authorityProbe = null;
    },
  );
  return promise;
}

export function clearKovaAuthCache(): void {
  cacheGeneration++;
  tokenCache = null;
  principalCache = null;
  for (const listener of authorityListeners) {
    try {
      listener();
    } catch {
      /* A view callback cannot prevent credential invalidation. */
    }
  }
}

export function isKovaSessionActive(): boolean {
  return kovaSessionActive;
}

export async function fetchKovaSession(): Promise<KovaBrowserPrincipal | null> {
  const generation = cacheGeneration;
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  // A response started before a credential change must not restore the old
  // principal after the MFA/device control has invalidated the cache.
  if (generation !== cacheGeneration) throw new Error("kova_session_changed");
  if (response.status === 401) {
    // Also invalidate compatibility tokens and requests already in flight. The
    // provider keeps Kova authority selected so rejection cannot reveal a stale
    // hosted login, while still making the ordinary sign-in controls usable.
    clearKovaAuthCache();
    principalCache = { principal: null, refreshAt: Date.now() + 5_000 };
    throw new KovaSessionRejectedError();
  }
  if (!response.ok) throw new Error(`kova_session_${response.status}`);
  const payload = (await response.json()) as { session?: unknown };
  if (generation !== cacheGeneration) throw new Error("kova_session_changed");
  if (payload.session === null) {
    principalCache = { principal: null, refreshAt: Date.now() + 5_000 };
    return null;
  }
  const session = payload.session as Partial<KovaBrowserPrincipal> | undefined;
  if (
    !session ||
    typeof session.accountId !== "string" ||
    typeof session.sessionId !== "string" ||
    typeof session.email !== "string" ||
    typeof session.emailVerified !== "boolean" ||
    (session.assuranceLevel !== "aal1" && session.assuranceLevel !== "aal2") ||
    typeof session.expiresAt !== "string"
  ) {
    throw new Error("kova_session_invalid_response");
  }
  const principal = {
    accountId: session.accountId,
    sessionId: session.sessionId,
    email: session.email,
    emailVerified: session.emailVerified,
    displayName: typeof session.displayName === "string" ? session.displayName : null,
    assuranceLevel: session.assuranceLevel,
    expiresAt: session.expiresAt,
  };
  principalCache = { principal, refreshAt: Date.now() + 30_000 };
  return principal;
}

export async function getCachedKovaSession(): Promise<KovaBrowserPrincipal | null> {
  if (principalCache && principalCache.refreshAt > Date.now()) return principalCache.principal;
  return fetchKovaSession();
}

export async function getKovaCompatibilityToken(): Promise<string | null> {
  if (!kovaSessionActive) return null;
  if (tokenCache && tokenCache.refreshAt > Date.now()) return tokenCache.token;
  const generation = cacheGeneration;
  const response = await fetch("/api/auth/token", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) throw new Error(`kova_token_${response.status}`);
  const payload = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown };
  if (generation !== cacheGeneration || !kovaSessionActive) return null;
  if (
    typeof payload.accessToken !== "string" ||
    typeof payload.expiresIn !== "number" ||
    payload.expiresIn < 60
  ) {
    throw new Error("kova_token_invalid_response");
  }
  tokenCache = {
    token: payload.accessToken,
    refreshAt: Date.now() + Math.max(30, payload.expiresIn - 60) * 1000,
  };
  return tokenCache.token;
}

export async function kovaAuthJson(path: string, body: Record<string, unknown>): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // This is an invalidation hint only, never an identity or authorization claim.
  // Other tabs must re-read the HttpOnly cookie through the session endpoint.
  if (response.ok) announceKovaAuthChange();
  return response;
}

export const KOVA_AUTH_CHANGE_KEY = "kova:auth-change";

export function announceKovaAuthChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KOVA_AUTH_CHANGE_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Focus/pageshow/visibility probes remain active when storage is unavailable.
  }
}
