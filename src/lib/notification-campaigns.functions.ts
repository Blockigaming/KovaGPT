import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loose } from "@/lib/supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { monthlyIntroBillingEnabled } from "@/lib/stripe.server";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { NOTIFICATION_GROUPS } from "@/lib/notification-catalog.mjs";
import { safePersistedNoticeActionUrl } from "@/lib/persisted-notification-policy.mjs";
import { selectEligibleCampaignRows } from "@/lib/notification-campaign-policy.mjs";

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
const campaignOwnerSchema = z.object({ expectedOwnerId: z.string().uuid() }).strict();

/**
 * This is a read-only discovery endpoint. Announcement campaigns must already
 * have been reviewed, deployed, enabled, and given an expiration on the server.
 * Fail closed if plan authority, SQL migration, or entitlement data is missing.
 */
export const listEligibleAnnouncementCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => campaignOwnerSchema.parse(input))
  .handler(async ({ data, context }): Promise<AnnouncementCampaign[]> => {
    const userId = context.userId;
    if (data.expectedOwnerId !== userId) return [];
    const db = loose(supabaseAdmin);
    const now = new Date().toISOString();
    const monthly = monthlyIntroBillingEnabled();
    try {
      const status = await db
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
        .abortSignal(AbortSignal.timeout(10000));
      if (
        status.error ||
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
      // Exclude this account's dismissals and other tiers before limiting results.
      const campaigns = await db
        .from("kova_notification_campaigns")
        .select(
          "id,event_id,release_id,title,body,action_path,allowed_tiers,dismissed:kova_notification_campaign_dismissals()",
        )
        .eq("enabled", true)
        .lte("starts_at", now)
        .gt("ends_at", now)
        .contains("allowed_tiers", [tier])
        .eq("dismissed.user_id", userId)
        .is("dismissed", null)
        .order("starts_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(20)
        .abortSignal(AbortSignal.timeout(10000));
      if (campaigns.error || !Array.isArray(campaigns.data)) return [];
      const rows = campaigns.data as CampaignRow[];
      const announcementIDs = new Set(NOTIFICATION_GROUPS.announcements);
      return selectEligibleCampaignRows(rows, {
        tier,
        allowedEventIds: announcementIDs,
        safeActionUrl: safePersistedNoticeActionUrl,
      }).map((row) => ({
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
  .validator((input: unknown) =>
    campaignOwnerSchema.extend({ campaignId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.expectedOwnerId !== context.userId) throw new Error("Announcement account changed.");
    const db = loose(supabaseAdmin);
    const result = await db
      .from("kova_notification_campaign_dismissals")
      .upsert(
        { campaign_id: data.campaignId, user_id: context.userId },
        { onConflict: "campaign_id,user_id", ignoreDuplicates: true },
      )
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error) throw new Error("Announcement dismissal could not be saved.");
    return { ok: true as const };
  });
