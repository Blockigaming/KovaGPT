import type { AuthedCaller } from "@/lib/api-auth.server";
import type { BillingTier } from "@/lib/billing-plans";
import {
  chatUsageWindows,
  CHAT_USAGE_WINDOWS,
  isUnlimitedBasicChat,
} from "@/lib/plan-usage-policy.mjs";
import { loose } from "@/lib/supabase-loose";

/** One atomic reservation: concurrent sends cannot spend the same last slot. */
export async function enforceDailyMessageQuota(
  caller: AuthedCaller,
  tier: BillingTier,
  thinking: boolean,
  signal?: AbortSignal,
  selection?: { modelId: string; mode: string },
): Promise<Response | null> {
  signal?.throwIfAborted();
  if (selection && isUnlimitedBasicChat(tier, selection.modelId, selection.mode)) return null;
  const windows = chatUsageWindows(tier);
  const [daily] = windows;
  const weekly = windows.find(({ id }) => id === "weekly");
  const short = windows.find(({ id }) => id === "five_hour");
  const query = weekly
    ? loose(caller.supabaseAdmin).rpc("try_consume_paid_message", {
        _user_id: caller.userId,
        _thinking: thinking,
        _weekly_limit: thinking ? weekly.thinkingLimit : weekly.regularLimit,
        _short_limit: short ? (thinking ? short.thinkingLimit : short.regularLimit) : null,
      })
    : loose(caller.supabaseAdmin).rpc("try_consume_daily_message", {
        _user_id: caller.userId,
        _thinking: thinking,
        _regular_limit: daily.regularLimit,
        _thinking_limit: daily.thinkingLimit,
      });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  const outcome: unknown = data;
  const exhausted = weekly
    ? outcome === "weekly" || (short && outcome === "five_hour")
      ? outcome
      : null
    : outcome === false
      ? "daily"
      : null;
  const allowed = weekly ? outcome === "allowed" : outcome === true;
  if (error || (!allowed && !exhausted))
    return Response.json(
      {
        error: "Your message allowance could not be checked. Try again shortly.",
        code: "message_quota_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  if (exhausted)
    return Response.json(
      {
        error: `Your ${CHAT_USAGE_WINDOWS[exhausted].toLowerCase()} ${thinking ? "Thinking" : "regular message"} allowance is used.`,
        code: exhausted === "daily" ? "daily_message_limit" : "message_window_limit",
        resetsAt: windows.find(({ id }) => id === exhausted)?.resetsAt,
        category: "quota_exceeded",
        retryable: false,
        kind: thinking ? "thinking" : "regular",
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  return null;
}
