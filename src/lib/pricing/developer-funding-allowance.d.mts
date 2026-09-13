export function fundingAdjustedVersion<T>(
  version: T,
  account: { funding_collection_rate?: unknown },
): T;
