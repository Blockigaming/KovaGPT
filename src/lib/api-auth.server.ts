// Server-only helpers used by /api/* route handlers to authenticate
// callers and enforce per-user daily quotas. NEVER import from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const DAILY_IMAGE_LIMIT = 1;
export const DAILY_CHAT_LIMIT = 50;
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

async function readCurrent(
  caller: AuthedCaller,
  date: string,
): Promise<{ images: number; chats: number }> {
  const { data } = await caller.supabaseAdmin
    .from("daily_usage")
    .select("images, chats")
    .eq("user_id", caller.userId)
    .eq("usage_date", date)
    .maybeSingle();
  return { images: data?.images ?? 0, chats: data?.chats ?? 0 };
}

export async function enforceQuota(
  caller: AuthedCaller,
  kind: "images" | "chats",
  limit: number,
): Promise<Response | null> {
  const today = new Date().toISOString().slice(0, 10);
  const current = await readCurrent(caller, today);
  const used = current[kind];
  if (used >= limit) {
    return tooMany(
      kind === "images"
        ? `Daily image limit reached (${limit}/day). Try again tomorrow or upgrade.`
        : `Daily message limit reached (${limit}/day). Try again tomorrow or upgrade.`,
    );
  }
  const next = used + 1;
  const row =
    kind === "images"
      ? { user_id: caller.userId, usage_date: today, images: next, chats: current.chats, updated_at: new Date().toISOString() }
      : { user_id: caller.userId, usage_date: today, chats: next, images: current.images, updated_at: new Date().toISOString() };
  await caller.supabaseAdmin
    .from("daily_usage")
    .upsert(row, { onConflict: "user_id,usage_date" });
  return null;
}
