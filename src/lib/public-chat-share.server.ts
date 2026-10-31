import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVerifiedUser } from "./api-auth.server";
import { isCrossSiteMutation } from "./auth-security.mjs";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { BodyReadError, readUtf8BodyBounded } from "./endpoint-reliability.mjs";
import {
  createShareToken,
  publicShareSnapshot,
  shareTokenHash,
  validShareToken,
} from "./public-chat-share-policy.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
export async function handleShareManagement(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
  try {
    if (request.method !== "GET" && isCrossSiteMutation(request))
      return json({ error: "Cross-site request blocked." }, 403);
    const auth = await requireVerifiedUser(request);
    if (auth instanceof Response) return auth;
    if (request.headers.get("x-kova-owner") !== auth.userId)
      return json({ error: "Your account changed. Try again." }, 409);
    const rate = await consumeApplicationRateLimit({
      identity: `user:${auth.userId}`,
      action: "chat_share_management",
      limit: 30,
      windowSeconds: 60,
    });
    if (!rate.allowed)
      return json(
        { error: "Please wait before trying again." },
        rate.status === "unavailable" ? 503 : 429,
      );
    const db = auth.supabaseAdmin as SupabaseClient;
    const fence = await db
      .from("account_deletion_fences")
      .select("user_id")
      .eq("user_id", auth.userId)
      .abortSignal(signal)
      .maybeSingle();
    if (fence.error || fence.data)
      return json({ error: "Sharing is unavailable for this account." }, 403);
    if (request.method === "GET") {
      const result = await db
        .from("chat_public_shares")
        .select("id,title,created_at,expires_at")
        .eq("owner_id", auth.userId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100)
        .abortSignal(signal);
      if (result.error) throw new Error();
      return json({ links: result.data });
    }
    const body = JSON.parse(await readUtf8BodyBounded(request, 524288));
    if (request.method === "DELETE") {
      if (!/^[0-9a-f-]{36}$/iu.test(body?.id ?? ""))
        return json({ error: "Invalid share link." }, 400);
      const result = await db
        .from("chat_public_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("owner_id", auth.userId)
        .select("id")
        .abortSignal(signal)
        .maybeSingle();
      if (result.error) throw new Error();
      return result.data ? json({ revoked: true }) : json({ error: "Share link not found." }, 404);
    }
    let payload;
    try {
      payload = publicShareSnapshot(body);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Invalid share content." },
        400,
      );
    }
    const token = createShareToken();
    const result = await db
      .from("chat_public_shares")
      .insert({ owner_id: auth.userId, token_hash: await shareTokenHash(token), ...payload })
      .select("id,expires_at")
      .abortSignal(signal)
      .single();
    if (result.error?.message?.includes("public_share_limit"))
      return json(
        {
          error: "Your shared snapshots are full. Remove an existing link or share a shorter chat.",
        },
        409,
      );
    if (result.error || !result.data) throw new Error();
    // Recheck before handing out a public capability after a concurrent deletion.
    const after = await db
      .from("account_deletion_fences")
      .select("user_id")
      .eq("user_id", auth.userId)
      .abortSignal(signal)
      .maybeSingle();
    if (after.error || after.data || (auth.revalidateSession && !(await auth.revalidateSession())))
      return json({ error: "Your account changed. The link was not copied." }, 409);
    return json({ id: result.data.id, path: `/share/${token}`, expiresAt: result.data.expires_at });
  } catch (error) {
    if (error instanceof BodyReadError)
      return json({ error: "The chat is too large or invalid." }, error.status);
    if (error instanceof SyntaxError) return json({ error: "Invalid share request." }, 400);
    return json({ error: "Sharing is temporarily unavailable. Your chat is unchanged." }, 503);
  }
}
export async function handlePublicChatShare(request: Request, token: string) {
  if (!validShareToken(token)) return json({ error: "This shared chat is unavailable." }, 404);
  try {
    const globalRate = await consumeApplicationRateLimit({
      identity: "public:chat-share-read",
      action: "public_chat_share_global",
      limit: 500,
      windowSeconds: 60,
    });
    if (!globalRate.allowed)
      return json(
        { error: "Shared chats are busy. Try again shortly." },
        globalRate.status === "unavailable" ? 503 : 429,
      );
    const hash = await shareTokenHash(token);
    const rate = await consumeApplicationRateLimit({
      identity: `share:${hash}`,
      action: "public_chat_share",
      limit: 120,
      windowSeconds: 60,
    });
    if (!rate.allowed)
      return json(
        { error: "Please try again shortly." },
        rate.status === "unavailable" ? 503 : 429,
      );
    const result = await (supabaseAdmin as SupabaseClient)
      .rpc("read_public_chat_share", { p_token_hash: hash })
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error) throw new Error();
    return result.data
      ? json(result.data)
      : json({ error: "This shared chat expired or was removed." }, 404);
  } catch {
    return json({ error: "This shared chat could not be loaded. Try again." }, 503);
  }
}
