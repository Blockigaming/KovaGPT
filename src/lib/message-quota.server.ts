import type { AuthedCaller } from "@/lib/api-auth.server";
import type { BillingTier } from "@/lib/billing-plans";
import { DAILY_PLAN_ALLOWANCES } from "@/lib/plan-usage-policy.mjs";
import { loose } from "@/lib/supabase-loose";

/** One atomic reservation: concurrent sends cannot spend the same last slot. */
export async function enforceDailyMessageQuota(
  caller: AuthedCaller,
  tier: BillingTier,
  thinking: boolean,
  signal?: AbortSignal,
): Promise<Response | null> {
  signal?.throwIfAborted();
  const limits = DAILY_PLAN_ALLOWANCES[tier];
  const query = loose(caller.supabaseAdmin).rpc("try_consume_daily_message", {
    _user_id: caller.userId,
    _thinking: thinking,
    _regular_limit: limits.regularMessages,
    _thinking_limit: limits.thinkingMessages,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error || typeof data !== "boolean")
    return Response.json(
      {
        error: "Your message allowance could not be checked. Try again shortly.",
        code: "message_quota_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  if (!data)
    return Response.json(
      {
        error: `Today's ${thinking ? "Thinking" : "regular message"} allowance is used. It resets at midnight UTC.`,
        code: "daily_message_limit",
        kind: thinking ? "thinking" : "regular",
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  return null;
}
