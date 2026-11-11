import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
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
  void list().then((campaigns) => {
   if (cancelled || !Array.isArray(campaigns)) return;
   // Never stack multiple marketing prompts in the same session.
   for (const campaign of campaigns.slice(0, 1)) {
    const actionUrl = campaign.actionUrl;
    const acknowledge = () => {
     void dismiss({ data: { campaignId: campaign.id } }).catch(() => {
      // The local suppression policy still prevents repeated reminders in this
      // browser. The server can retry cross-device dismissal next visit.
     });
    };
    publishKovaNotice({
     id: campaign.eventId,
     title: campaign.title,
     message: campaign.message,
     key: "campaign:" + campaign.id,
     campaignId: campaign.id,
     confirmed: true,
     ...(actionUrl ? {
      primaryLabel: "Explore",
      onPrimary: () => { window.location.assign(actionUrl); },
     } : {}),
     secondaryLabel: "Not now",
     onDismiss: acknowledge,
    });
   }
  }).catch(() => {
   // Unavailable campaign infrastructure must never block chat navigation.
  });
  return () => { cancelled = true; };
 }, [dismiss, list, ownerId]);
 return null;
}
