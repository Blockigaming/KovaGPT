export type DeepResearchTier = "free" | "plus" | "pro";

export type DeepResearchAccess = {
  allowed: boolean;
  status: number;
  error: string | null;
};

export function getDeepResearchAccess(input: {
  requested: boolean;
  authenticated: boolean;
  tier: DeepResearchTier;
  owner: boolean;
}): DeepResearchAccess;
