import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { rememberNoticeDismissal } from "@/lib/notification-dismissal-policy.mjs";
import {
  listEligibleAnnouncementCampaigns,
  dismissAnnouncementCampaign,
} from "@/lib/notification-campaigns.functions";

/** No hardcoded rollout offers: only active, verified server campaign records. */
export function AnnouncementCampaignBridge({ ownerId }: { ownerId: string | null }) {
  const list = useServerFn(listEligibleAnnouncementCampaigns);
  const dismiss = useServerFn(dismissAnnouncementCampaign);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void list()
      .then((campaigns) => {
        if (cancelled || !Array.isArray(campaigns)) return;
        // Never stack multiple marketing prompts in the same session.
        for (const campaign of campaigns.slice(0, 1)) {
          const actionUrl = campaign.actionUrl;
          let recorded: Promise<void> | null = null;
          const acknowledge = () => {
            try {
              rememberNoticeDismissal(window.localStorage, {
                accountId: ownerId,
                id: campaign.eventId,
                campaignId: campaign.id,
                group: "announcements",
              });
            } catch {
              // Browser storage may be unavailable; the server remains authoritative.
            }
            recorded ??= dismiss({ data: { campaignId: campaign.id } })
              .then(() => undefined)
              .catch(() => undefined);
            return recorded;
          };
          publishKovaNotice({
            id: campaign.eventId,
            title: campaign.title,
            message: campaign.message,
            key: "campaign:" + campaign.id,
            campaignId: campaign.id,
            confirmed: true,
            ...(actionUrl
              ? {
                  primaryLabel: "Explore",
                  onPrimary: async () => {
                    // Persist dismissal first. Navigation must not cancel the
                    // only server request intended to prevent repeated prompts.
                    await acknowledge();
                    if (!cancelled) window.location.assign(actionUrl);
                  },
                }
              : {}),
            secondaryLabel: "Not now",
            onDismiss: () => {
              void acknowledge();
            },
          });
        }
      })
      .catch(() => {
        // Unavailable campaign infrastructure must never block chat navigation.
      });
    return () => {
      cancelled = true;
    };
  }, [dismiss, list, ownerId]);
  return null;
}
