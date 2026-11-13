import { createServerFn } from "@tanstack/react-start";
import { loose } from "@/lib/supabase-loose";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveEffectiveBillingTier,
  resolveEffectiveUsageMultiplier,
} from "@/lib/billing-entitlement.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chatUsageWindows } from "@/lib/plan-usage-policy.mjs";
import type { BillingTier } from "@/lib/billing-plans";

export type DailyUsageDto = {
  date: string;
  chats: number;
  thinking: number;
  images: number;
  uploads: number;
  resetsAt: string; // next UTC midnight ISO
};

type ChatWindow = ReturnType<typeof chatUsageWindows>[number];
type ChatCounts = { regularUsed: number; thinkingUsed: number };
type HourlyRow = { regular_messages: number; thinking_messages: number };
export type PlanUsageDto = {
  tier: BillingTier;
  usageMultiplier?: 1 | 5;
  windows: (ChatWindow & {
    regularUsed: number | null;
    thinkingUsed: number | null;
    costPercentUsed: number | null;
  })[];
  images: number | null;
  uploads: number | null;
};

export const getMyPlanUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { ownerId: string }) => data)
  .handler(async ({ context, data }): Promise<PlanUsageDto> => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed.");
    const tier = await resolveEffectiveBillingTier(supabaseAdmin, context.userId);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const usageMultiplier =
      tier === "pro" ? await resolveEffectiveUsageMultiplier(supabaseAdmin, context.userId) : 1;
    const windows = chatUsageWindows(tier, now, usageMultiplier);
    const ledgerStart = windows.find(({ id }) => id === "weekly")?.start.slice(0, 10) ?? today;
    const short = windows.find(({ id }) => id === "five_hour");
    const [ledger, shortWindow, costProgress] = await Promise.all([
      loose(supabaseAdmin)
        .from("daily_usage")
        .select("usage_date, chats, thinking_chats, images, uploads")
        .eq("user_id", context.userId)
        .gte("usage_date", ledgerStart)
        .lte("usage_date", today)
        .abortSignal(AbortSignal.timeout(10_000)),
      short
        ? loose(supabaseAdmin)
            .from("message_usage_hourly")
            .select("regular_messages, thinking_messages")
            .eq("user_id", context.userId)
            .gte("window_start", short.start)
            .lte(
              "window_start",
              new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString(),
            )
            .abortSignal(AbortSignal.timeout(10_000))
        : null,
      loose(supabaseAdmin)
        .rpc("kova_plan_cost_progress", { _user_id: context.userId, _plan: tier })
        .abortSignal(AbortSignal.timeout(10_000)),
    ]);
    if (ledger.error || shortWindow?.error)
      console.error("[getMyPlanUsage] usage ledger unavailable", {
        daily: ledger.error?.code,
        hourly: shortWindow?.error?.code,
      });
    if (ledger.error && (shortWindow === null || shortWindow.error) && !costProgress.data?.[0])
      throw new Error("Usage data is temporarily unavailable.");
    const rows: {
      usage_date: string;
      chats: number;
      thinking_chats: number;
      images: number;
      uploads: number;
    }[] = ledger.data ?? [];
    const daily = rows.find(({ usage_date }) => usage_date === today);
    const total = rows.reduce(
      (sum, row) => ({
        regularUsed: sum.regularUsed + row.chats - row.thinking_chats,
        thinkingUsed: sum.thinkingUsed + row.thinking_chats,
      }),
      { regularUsed: 0, thinkingUsed: 0 },
    );
    const shortTotals = (shortWindow?.data ?? []).reduce(
      (total: ChatCounts, row: HourlyRow) => ({
        regularUsed: total.regularUsed + row.regular_messages,
        thinkingUsed: total.thinkingUsed + row.thinking_messages,
      }),
      { regularUsed: 0, thinkingUsed: 0 },
    );
    const costState = costProgress.data?.[0] as
      | {
          weekly_used: number | string;
          weekly_allowance: number | string;
          five_hour_used: number | string;
          five_hour_allowance: number | string | null;
        }
      | undefined;
    if (costProgress.error)
      console.error("[getMyPlanUsage] cost progress unavailable", costProgress.error.code);
    const asPercent = (used: number | string, allowance: number | string | null) => {
      const consumed = Number(used);
      const capacity = Number(allowance);
      return allowance !== null &&
        Number.isFinite(consumed) &&
        Number.isFinite(capacity) &&
        capacity > 0
        ? Math.min(100, Math.max(0, Math.ceil((100 * consumed) / capacity)))
        : 0;
    };
    return {
      tier,
      usageMultiplier,
      windows: windows.map((window) => ({
        ...window,
        ...(window.id === "five_hour"
          ? shortWindow?.error
            ? { regularUsed: null, thinkingUsed: null }
            : shortTotals
          : ledger.error
            ? { regularUsed: null, thinkingUsed: null }
            : total),
        costPercentUsed: !costState
          ? null
          : window.id === "five_hour"
            ? asPercent(costState.five_hour_used, costState.five_hour_allowance)
            : asPercent(costState.weekly_used, costState.weekly_allowance),
      })),
      images: ledger.error ? null : (daily?.images ?? 0),
      uploads: ledger.error ? null : (daily?.uploads ?? 0),
    };
  });

export const getMyDailyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DailyUsageDto> => {
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    const nextMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1),
    );

    const { data, error } = await loose(context.supabase)
      .from("daily_usage")
      .select("usage_date, chats, thinking_chats, images, uploads")
      .eq("user_id", context.userId)
      .eq("usage_date", ymd)
      .maybeSingle();

    if (error) {
      console.error("[getMyDailyUsage] read error", error.message);
      throw new Error("Usage data is temporarily unavailable. Please try again.");
    }

    if (!data) {
      return {
        date: ymd,
        chats: 0,
        thinking: 0,
        images: 0,
        uploads: 0,
        resetsAt: nextMidnight.toISOString(),
      };
    }

    return {
      date: ymd,
      chats: data.chats ?? 0,
      thinking: data.thinking_chats ?? 0,
      images: data.images ?? 0,
      uploads: data.uploads ?? 0,
      resetsAt: nextMidnight.toISOString(),
    };
  });
