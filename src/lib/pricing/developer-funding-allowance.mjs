import { PricingUnavailableError } from "./cost-plus.mjs";
/** Apply only server-recorded funding costs; preserve the approved pricing object's identity and other allowances. */
export function fundingAdjustedVersion(version, account) {
  if (account.funding_collection_rate == null) return version;
  const floor = Number(account.funding_collection_rate);
  if (!Number.isFinite(floor) || floor < 0)
    throw new PricingUnavailableError("funding_collection_rate_invalid");
  const allowances = version?.allowance_configuration,
    approved = Number(allowances?.collectionPercentage);
  if (!allowances || !Number.isFinite(approved) || approved < 0)
    throw new PricingUnavailableError("billing_allowances_invalid");
  if (floor <= approved) return version;
  return { ...version, allowance_configuration: { ...allowances, collectionPercentage: floor } };
}
