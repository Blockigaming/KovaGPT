// Server-only helpers used by /api/* route handlers to authenticate
// callers and enforce per-user daily quotas. NEVER import from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const DAILY_IMAGE_LIMIT = 1;
export const DAILY_CHAT_LIMIT = 50;
export const DAILY_UPLOAD_LIMIT = 2;



export type AuthedCaller = {
  userId: string;
  supabaseAdmin: SupabaseClient<Database>;
  emailVerified: boolean;
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function unauthorized(message = "Unauthorized") {
  return jsonError(message, 401);
}

export function tooMany(message = "Daily limit reached") {
  return jsonError(message, 429);
}

export async function requireUser(
  request: Request,
): Promise<AuthedCaller | Response> {
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
export async function optionalUser(
  request: Request,
): Promise<AuthedCaller | null | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError("Auth backend not configured", 500);
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const verifier = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return unauthorized("Invalid or expired session");

  const supabaseAdmin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const emailVerified =
    (data?.claims as { email_verified?: boolean } | undefined)?.email_verified === true;
  return { userId, supabaseAdmin, emailVerified };
}

/**
 * Like requireUser, but additionally requires a verified email address.
 * Use for high-cost / abuse-prone actions (image gen, voice, uploads).
 */
export async function requireVerifiedUser(
  request: Request,
): Promise<AuthedCaller | Response> {
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
): Promise<Response | null> {
  // Atomic check-and-increment via SECURITY DEFINER RPC. Row-level locking
  // inside the function prevents TOCTOU races where concurrent requests all
  // pass the limit check before any increment lands.
  const { data, error } = await caller.supabaseAdmin.rpc("try_increment_daily_usage", {
    _user_id: caller.userId,
    _kind: kind,
    _increment: increment,
    _limit: limit,
  });
  if (error) {
    console.error("[enforceQuota] rpc error", error);
    return jsonError("Quota check failed", 500);
  }
  if (data === false) {
    const label =
      kind === "images" ? "image" : kind === "uploads" ? "file upload" : "message";
    return tooMany(
      `Daily ${label} limit reached (${limit}/day). Resets in 24 hours or upgrade for more.`,
    );
  }
  return null;
}

/**
 * Returns the tier the user is currently entitled to, derived from the
 * latest active subscription row. Never trust the client's `mode` choice
 * without checking this — the client can be edited.
 */
export type CallerTier = "free" | "plus" | "pro";

export async function getCallerTier(caller: AuthedCaller): Promise<CallerTier> {
  const { data } = await caller.supabaseAdmin
    .from("subscriptions")
    .select("price_id, status, current_period_end")
    .eq("user_id", caller.userId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (!data || data.length === 0) return "free";
  const now = Date.now();
  for (const row of data) {
    const end = row.current_period_end ? new Date(row.current_period_end).getTime() : 0;
    const active =
      (["active", "trialing", "past_due"].includes(row.status) && (!row.current_period_end || end > now)) ||
      (row.status === "canceled" && end > now);
    if (!active) continue;
    const id = (row.price_id ?? "").toLowerCase();
    if (id.includes("pro")) return "pro";
    if (id.includes("plus")) return "plus";
  }
  return "free";
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
    return null; // fail-open on transient errors; logged for ops
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
 * Flags: 'chat' | 'images' | 'uploads' | 'voice' | 'signups'
 */
export async function assertFeatureEnabled(
  caller: AuthedCaller,
  feature: "chat" | "images" | "uploads" | "voice" | "signups",
): Promise<Response | null> {
  const { data } = await caller.supabaseAdmin
    .from("feature_flags")
    .select("enabled")
    .eq("name", feature)
    .maybeSingle();
  if (data && data.enabled === false) {
    return jsonError(
      `${feature[0].toUpperCase() + feature.slice(1)} is temporarily unavailable for maintenance. Please try again shortly.`,
      503,
    );
  }
  return null;
}



