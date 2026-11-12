export type EligibleCampaignRow = {
  id: string;
  event_id: string;
  release_id: string;
  title: string;
  body: string;
  action_path: string | null;
  allowed_tiers: string[];
};

export declare function selectEligibleCampaignRows<T extends EligibleCampaignRow>(
  rows: T[],
  options: {
    tier: string;
    dismissedIds?: ReadonlySet<string>;
    allowedEventIds: ReadonlySet<string>;
    safeActionUrl: (value: string) => string | null;
  },
): T[];
