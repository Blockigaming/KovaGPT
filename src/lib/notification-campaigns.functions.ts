import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loose } from "@/lib/supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { monthlyIntroBillingEnabled } from "@/lib/stripe.server";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { NOTIFICATION_GROUPS } from "@/lib/notification-catalog.mjs";
import { safePersistedNoticeActionUrl } from "@/lib/persisted-notification-policy.mjs";

export type AnnouncementCampaign = {
  id: string;
  eventId: string;
  releaseId: string;
  title: string;
  message: string;
  actionUrl: string | null;
};
type CampaignRow = {
  id: string;
  event_id: string;
  release_id: string;
  title: string;
  body: string;
  action_path: string | null;
  allowed_tiers: string[];
};

/**
 * This is a read-only discovery endpoint. Announcement campaigns must already
 * have been reviewed, deployed, enabled, and given an expiration on the server.
 * Fail closed if plan authority, SQL migration, or entitlement data is missing.
 */
export const listEligibleAnnouncementCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnnouncementCampaign[]> => {
    const userId = context.userId;
    const db = loose(supabaseAdmin);
    const now = new Date().toISOString();
    const monthly = monthlyIntroBillingEnabled();
    try {
      const [status, campaigns] = await Promise.all([
        db
          .rpc(
            monthly ? "kova_monthly_subscription_summary" : "user_subscription_summary",
            monthly
              ? {
                  p_user: userId,
                  p_plus_price: BILLING_PLANS.plus_monthly.livePriceId,
                  p_pro_price: BILLING_PLANS.pro_monthly.livePriceId,
                }
              : { _user_id: userId },
          )
          .abortSignal(AbortSignal.timeout(10000)),
        db
          .from("kova_notification_campaigns")
          .select("id,event_id,release_id,title,body,action_path,allowed_tiers")
          .eq("enabled", true)
          .lte("starts_at", now)
          .gt("ends_at", now)
          .order("starts_at", { ascending: false })
          .limit(20)
          .abortSignal(AbortSignal.timeout(10000)),
      ]);
      if (
        status.error ||
        campaigns.error ||
        !status.data ||
        typeof status.data !== "object" ||
        Array.isArray(status.data)
      )
        return [];
      const summary = status.data as Record<string, unknown>;
      if (
        summary.billingConflict === true ||
        summary.billingSetupIncomplete === true ||
        !["free", "plus", "pro"].includes(String(summary.effectiveTier))
      )
        return [];
      const tier = String(summary.effectiveTier);
      const rows = Array.isArray(campaigns.data) ? (campaigns.data as CampaignRow[]) : [];
      if (!rows.length) return [];
      const dismissed = await db
        .from("kova_notification_campaign_dismissals")
        .select("campaign_id")
        .eq("user_id", userId)
        .in(
          "campaign_id",
          rows.map((row) => row.id),
        )
        .abortSignal(AbortSignal.timeout(10000));
      if (dismissed.error) return [];
      const excluded = new Set(
        (dismissed.data ?? []).map((row: { campaign_id: string }) => row.campaign_id),
      );
      const announcementIDs = new Set(NOTIFICATION_GROUPS.announcements);
      return rows
        .filter(
          (row) =>
            !excluded.has(row.id) &&
            announcementIDs.has(row.event_id) &&
            Array.isArray(row.allowed_tiers) &&
            row.allowed_tiers.includes(tier) &&
            /^[0-9a-f-]{36}$/i.test(row.id) &&
            typeof row.release_id === "string" &&
            row.release_id.length <= 80 &&
            typeof row.title === "string" &&
            row.title.length <= 120 &&
            typeof row.body === "string" &&
            row.body.length <= 700 &&
            (row.action_path === null || safePersistedNoticeActionUrl(row.action_path) !== null),
        )
        .slice(0, 2)
        .map((row) => ({
          id: row.id,
          eventId: row.event_id,
          releaseId: row.release_id,
          title: row.title,
          message: row.body,
          actionUrl: row.action_path ? safePersistedNoticeActionUrl(row.action_path) : null,
        }));
    } catch {
      return [];
    }
  });

export const dismissAnnouncementCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ campaignId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const db = loose(supabaseAdmin);
    const result = await db
      .from("kova_notification_campaign_dismissals")
      .upsert(
        { campaign_id: data.campaignId, user_id: context.userId },
        { onConflict: "campaign_id,user_id" },
      );
    if (result.error) throw new Error("Announcement dismissal could not be saved.");
    return { ok: true as const };
  });
