// Server-only helpers used by /api/* route handlers to authenticate
// callers and enforce per-user daily quotas. NEVER import from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BillingTier } from "@/lib/billing-plans";
import { resolveEffectiveBillingTier } from "@/lib/billing-entitlement.server";
import {
  evaluateAuthenticatedUser,
  isCrossSiteMutation,
  parseBearerToken,
} from "@/lib/auth-security.mjs";
import { resolveKovaAuthMode, selectAuthCredential } from "@/lib/kova-auth-contract.mjs";
import { digestKovaToken, signKovaCompatibilityJwt } from "@/lib/kova-auth-crypto.server.mjs";
import { resolveSession } from "@/lib/kova-auth-store.server";

export const DAILY_IMAGE_LIMIT = 1;
export const DAILY_CHAT_LIMIT = 50;
export const DAILY_UPLOAD_LIMIT = 2;
export type AuthedCaller = {
  userId: string;
  // Internal, separately authenticated service actors also reuse this data
  // context. Only an HTTP session principal must carry a browser authority.
  authProvider?: "kova" | "supabase";
  supabaseUser: SupabaseClient<Database>;
  supabaseAdmin: SupabaseClient<Database>;
  emailVerified: boolean;
  claims?: Record<string, unknown>;
  // Server-only closure bound to the original cookie. Never serialized or
  // supplied by the browser; long operations use it before exposing results.
  revalidateSession?: () => Promise<boolean>;
};

export type HttpAuthedCaller = AuthedCaller & { authProvider: "kova" | "supabase" };

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export function unauthorized(message = "Unauthorized") {
  return jsonError(message, 401);
}

export function tooMany(message = "Daily limit reached") {
  return jsonError(message, 429);
}

export async function requireUser(request: Request): Promise<HttpAuthedCaller | Response> {
  const result = await optionalUser(request);
  if (!result) return unauthorized();
  if (result instanceof Response) return result;
  return result;
}

/**
 * Returns the authed caller if the request carries a valid bearer token,
 * `null` if the request is anonymous (no token at all), or a Response when
 * the token is present but invalid/expired.
 */
export async function optionalUser(request: Request): Promise<HttpAuthedCaller | null | Response> {
  // Anonymous requests do not need an auth client. Check the credential first
  // so protected routes return a truthful 401 even when a deployment is
  // missing auth configuration, rather than exposing configuration state as a
  // 500 response to unauthenticated callers.
  let credential: ReturnType<typeof selectAuthCredential>;
  try {
    credential = selectAuthCredential(request, resolveKovaAuthMode());
  } catch {
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
  if (credential.kind === "anonymous") return null;
  if (credential.kind === "invalid") return unauthorized("Invalid or expired session");
  // Cookie authority is ambient. Existing bearer-only callers did not all need
  // an origin check, so enforce this once before any owned-auth/database work.
  if (
    credential.provider === "kova" &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()) &&
    (isCrossSiteMutation(request) ||
      (!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin"))
  ) {
    return jsonError("Cross-origin request rejected", 403);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[auth] Supabase server authentication configuration is incomplete", {
      missing: [
        !SUPABASE_URL ? "SUPABASE_URL" : null,
        !SUPABASE_PUBLISHABLE_KEY ? "SUPABASE_PUBLISHABLE_KEY" : null,
        !SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter(Boolean),
    });
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
  const createAdminClient = () =>
    createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

  if (credential.provider === "kova") {
    try {
      const sessionDigest = digestKovaToken(credential.token);
      const principal = await resolveSession(sessionDigest);
      if (!principal) return unauthorized("Invalid or expired session");
      const expectedOwner = request.headers.get("x-kova-owner");
      if (expectedOwner !== null && expectedOwner !== principal.accountId)
        return jsonError("Your account changed. Please try again.", 409);
      const compatibilityToken = signKovaCompatibilityJwt(principal);
      const verifier = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: `Bearer ${compatibilityToken}` } },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      const claims = {
        sub: principal.accountId,
        email: principal.email,
        email_verified: principal.emailVerified,
        aal: principal.assuranceLevel,
        session_id: principal.sessionId,
        role: "authenticated",
      };
      return {
        userId: principal.accountId,
        authProvider: "kova",
        supabaseUser: verifier,
        supabaseAdmin: createAdminClient(),
        emailVerified: principal.emailVerified,
        claims,
        revalidateSession: async () => {
          const current = await resolveSession(sessionDigest);
          return (
            current !== null &&
            current.accountId === principal.accountId &&
            current.sessionId === principal.sessionId &&
            current.email === principal.email &&
            current.emailVerified &&
            current.assuranceLevel === principal.assuranceLevel
          );
        },
      };
    } catch (error) {
      console.error("[auth] Kova session validation failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("Authentication is temporarily unavailable.", 503);
    }
  }

  const token = parseBearerToken(credential.authorization);
  if (!token) return unauthorized("Invalid or expired session");
  const verifier = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  // getClaims verifies the JWT signature, but a correctly signed access token
  // can outlive user deletion, a ban, or a server-side session revocation.
  // getUser performs the authoritative Auth server check before any service-role
  // client is created or user-controlled work is performed.
  const [{ data: userData, error: userError }, { data: claimsData, error: claimsError }] =
    await Promise.all([verifier.auth.getUser(token), verifier.auth.getClaims(token)]);
  if (userError || claimsError || !userData.user || !claimsData?.claims) {
    return unauthorized("Invalid or expired session");
  }

  // Compatibility JWTs authorize guarded data-plane requests, not the hosted
  // API bearer branch. Kova application requests must supply the owned cookie
  // so its live session is resolved above. Check only signature-verified claims,
  // and reject malformed marker values rather than treating them as legacy.
  if (Object.prototype.hasOwnProperty.call(claimsData.claims, "kova_auth")) {
    return unauthorized("Invalid or expired session");
  }

  const access = evaluateAuthenticatedUser(userData.user, claimsData.claims);
  if (!access.ok) {
    if (access.code === "account_suspended") {
      return jsonError(
        "Your account has been suspended. Contact support@kovagpt.com if you believe this is a mistake.",
        403,
      );
    }
    if (access.code === "mfa_required") {
      return jsonError("Two-factor authentication is required to continue.", 403);
    }
    return unauthorized("Invalid or expired session");
  }

  const expectedOwner = request.headers.get("x-kova-owner");
  if (expectedOwner !== null && expectedOwner !== access.userId)
    return jsonError("Your account changed. Please try again.", 409);
  const admin = createAdminClient();
  if (resolveKovaAuthMode() === "dual") {
    // Hosted JWT signatures do not prove that the account still accepts that
    // authority after a Kova password change or recovery. No fallback on error.
    try {
      const { data, error } = await admin.rpc(
        "kova_auth_legacy_session_allowed" as never,
        { p_account_id: access.userId } as never,
      );
      if (error) return jsonError("Authentication is temporarily unavailable.", 503);
      if (data !== true) return unauthorized("Invalid or expired session");
    } catch {
      return jsonError("Authentication is temporarily unavailable.", 503);
    }
  }

  return {
    userId: access.userId,
    authProvider: "supabase",
    // This client carries the verified caller's JWT and is therefore subject
    // to RLS. Use it for authorization lookups before service-role writes.
    supabaseUser: verifier,
    supabaseAdmin: admin,
    emailVerified: access.emailVerified,
    claims: claimsData.claims as Record<string, unknown>,
  };
}

/**
 * Like requireUser, but additionally requires a verified email address.
 * Use for high-cost / abuse-prone actions (image generation and uploads).
 */
export async function requireVerifiedUser(request: Request): Promise<HttpAuthedCaller | Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!auth.emailVerified) {
    return jsonError(
      "Please verify your email address before using this feature. Check your inbox for the confirmation link.",
      403,
    );
  }
  return auth;
}

export async function enforceQuota(
  caller: AuthedCaller,
  kind: "images" | "chats" | "uploads",
  limit: number,
  increment = 1,
  signal?: AbortSignal,
): Promise<Response | null> {
  // Atomic check-and-increment via SECURITY DEFINER RPC. Row-level locking
  // inside the function prevents TOCTOU races where concurrent requests all
  // pass the limit check before any increment lands.
  signal?.throwIfAborted();
  const quotaQuery = caller.supabaseAdmin.rpc("try_increment_daily_usage", {
    _user_id: caller.userId,
    _kind: kind,
    _increment: increment,
    _limit: limit,
  });
  const { data, error } = await (signal ? quotaQuery.abortSignal(signal) : quotaQuery);
  if (error) {
    console.error("[enforceQuota] rpc error", error);
    return jsonError("Quota check failed", 500);
  }
  if (data === false) {
    const label = kind === "images" ? "image" : kind === "uploads" ? "file upload" : "message";
    return tooMany(
      `Daily ${label} limit reached (${limit}/day). Resets in 24 hours or upgrade for more.`,
    );
  }
  return null;
}

/**
 * Atomically charge bytes against the user's cumulative storage budget.
 * Returns a 413 response when the upload would exceed the cap.
 */
export async function enforceStorage(
  caller: AuthedCaller,
  bytes: number,
  limitBytes: number,
): Promise<Response | null> {
  if (bytes <= 0) return null;
  const { data, error } = await caller.supabaseAdmin.rpc(
    "try_add_storage_bytes" as never,
    {
      _user_id: caller.userId,
      _bytes: bytes,
      _limit: limitBytes,
    } as never,
  );
  if (error) {
    console.error("[enforceStorage] rpc error", error);
    return jsonError("Storage check failed", 500);
  }
  if (data === false) {
    const gb = (limitBytes / 1024 ** 3).toFixed(0);
    return jsonError(
      `Storage limit reached (${gb} GB). Delete some files or upgrade for more.`,
      413,
    );
  }
  return null;
}

export type CallerTier = BillingTier;

/**
 * Resolve the server-authoritative effective plan, including family-owner
 * inheritance, through the exact database registry.
 */
export async function getUserTier(caller: AuthedCaller, userId: string): Promise<CallerTier> {
  return resolveEffectiveBillingTier(caller.supabaseAdmin, userId);
}

export async function getCallerTier(caller: AuthedCaller): Promise<CallerTier> {
  return getUserTier(caller, caller.userId);
}

/**
 * Returns 403 if the caller is banned. Banned rows are written by ops/admin only.
 */
export async function assertNotBanned(caller: AuthedCaller): Promise<Response | null> {
  const { data, error } = await caller.supabaseAdmin
    .from("banned_users")
    .select("user_id")
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (error) {
    console.error("[assertNotBanned] lookup error", error);
    // A failed moderation lookup must never silently grant access to costly or
    // consequential routes. The caller can retry once the backend recovers.
    return jsonError("Account status could not be verified. Please try again shortly.", 503);
  }
  if (data) {
    return jsonError(
      "Your account has been suspended. Contact support@kovagpt.com if you believe this is a mistake.",
      403,
    );
  }
  return null;
}

/**
 * Returns 503 if the named maintenance flag has been turned off by ops.
 * Flags: 'chat' | 'images' | 'uploads' | 'signups'
 */
export async function assertFeatureEnabled(
  caller: AuthedCaller,
  feature: "chat" | "images" | "uploads" | "signups",
): Promise<Response | null> {
  const { data, error } = await caller.supabaseAdmin
    .from("feature_flags")
    .select("enabled")
    .eq("name", feature)
    .maybeSingle();
  if (error) {
    console.error("[assertFeatureEnabled] lookup error", error);
    return jsonError("Feature availability could not be verified. Please try again shortly.", 503);
  }
  if (data && data.enabled === false) {
    return jsonError(
      `${feature[0].toUpperCase() + feature.slice(1)} is temporarily unavailable for maintenance. Please try again shortly.`,
      503,
    );
  }
  return null;
}
