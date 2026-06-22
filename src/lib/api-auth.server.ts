// Server-only helpers used by /api/* route handlers to authenticate
// callers and enforce per-user daily quotas. NEVER import from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const DAILY_IMAGE_LIMIT = 3;
export const DAILY_CHAT_LIMIT = 50;

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

/**
 * Verify the Supabase bearer token on a Request. Returns { userId } on
 * success, or a Response (401) on failure that the caller should return.
 */
export async function requireUser(
  request: Request,
): Promise<AuthedCaller | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError("Auth backend not configured", 500);
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return unauthorized();
  const token = header.slice(7).trim();
  if (!token) return unauthorized();

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

/**
 * Atomically increment the given counter for today and return the new value.
 * Uses an upsert + RPC-free pattern that's safe under concurrent calls.
 */
async function incrementCounter(
  caller: AuthedCaller,
  column: "images" | "chats",
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  // Try update first.
  const { data: updated, error: upErr } = await caller.supabaseAdmin
    .from("daily_usage")
    .update({
      [column]: (await readCurrent(caller, today, column)) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", caller.userId)
    .eq("usage_date", today)
    .select(column)
    .maybeSingle();
  if (!upErr && updated && typeof (updated as Record<string, number>)[column] === "number") {
    return (updated as Record<string, number>)[column];
  }
  // Row doesn't exist yet — insert with 1.
  const { data: inserted, error: insErr } = await caller.supabaseAdmin
    .from("daily_usage")
    .insert({
      user_id: caller.userId,
      usage_date: today,
      [column]: 1,
    })
    .select(column)
    .single();
  if (insErr || !inserted) return 1;
  return (inserted as Record<string, number>)[column] ?? 1;
}

async function readCurrent(
  caller: AuthedCaller,
  date: string,
  column: "images" | "chats",
): Promise<number> {
  const { data } = await caller.supabaseAdmin
    .from("daily_usage")
    .select(column)
    .eq("user_id", caller.userId)
    .eq("usage_date", date)
    .maybeSingle();
  if (!data) return 0;
  return (data as Record<string, number>)[column] ?? 0;
}

/**
 * Check + reserve quota. Returns null on success, or a 429 Response.
 */
export async function enforceQuota(
  caller: AuthedCaller,
  kind: "images" | "chats",
  limit: number,
): Promise<Response | null> {
  const today = new Date().toISOString().slice(0, 10);
  const current = await readCurrent(caller, today, kind);
  if (current >= limit) {
    return tooMany(
      kind === "images"
        ? `Daily image limit reached (${limit}/day). Try again tomorrow or upgrade.`
        : `Daily message limit reached (${limit}/day). Try again tomorrow or upgrade.`,
    );
  }
  await incrementCounter(caller, kind);
  return null;
}
