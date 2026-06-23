// Server-only helpers used by /api/* route handlers to authenticate
// callers and enforce per-user daily quotas. NEVER import from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const DAILY_IMAGE_LIMIT = 1;
export const DAILY_CHAT_LIMIT = 50;
export const DAILY_UPLOAD_LIMIT = 2;
const WINDOW_MS = 24 * 60 * 60 * 1000;


export type AuthedCaller = {
  userId: string;
  supabaseAdmin: SupabaseClient<Database>;
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
  return { userId, supabaseAdmin };
}

// Rolling 24h window: the most recent row tracks the current window.
// If its updated_at is older than 24h, the window has expired and we start
// fresh; otherwise we keep incrementing it.
async function readWindow(
  caller: AuthedCaller,
): Promise<{ images: number; chats: number; uploads: number; date: string; expired: boolean }> {
  const { data } = await caller.supabaseAdmin
    .from("daily_usage")
    .select("images, chats, uploads, usage_date, updated_at")
    .eq("user_id", caller.userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  if (!data) return { images: 0, chats: 0, uploads: 0, date: today, expired: true };
  const ageMs = Date.now() - new Date(data.updated_at as string).getTime();
  if (ageMs >= WINDOW_MS) {
    return { images: 0, chats: 0, uploads: 0, date: today, expired: true };
  }
  return {
    images: data.images ?? 0,
    chats: data.chats ?? 0,
    uploads: (data as { uploads?: number }).uploads ?? 0,
    date: data.usage_date as string,
    expired: false,
  };
}

export async function enforceQuota(
  caller: AuthedCaller,
  kind: "images" | "chats" | "uploads",
  limit: number,
  increment = 1,
): Promise<Response | null> {
  const current = await readWindow(caller);
  const used = current[kind];
  if (used + increment > limit) {
    const label =
      kind === "images" ? "image" : kind === "uploads" ? "file upload" : "message";
    return tooMany(
      `Daily ${label} limit reached (${limit}/day). Resets in 24 hours or upgrade for more.`,
    );
  }
  const next = used + increment;
  // When the window expired, start a new row keyed by today's date so the
  // upsert doesn't collide with the previous expired row.
  const dateKey = current.expired ? new Date().toISOString().slice(0, 10) : current.date;
  const row: Record<string, unknown> = {
    user_id: caller.userId,
    usage_date: dateKey,
    images: current.images,
    chats: current.chats,
    uploads: current.uploads,
    updated_at: new Date().toISOString(),
  };
  row[kind] = next;
  await caller.supabaseAdmin
    .from("daily_usage")
    .upsert(row as never, { onConflict: "user_id,usage_date" });
  return null;
}


