export function resolveAgentEntitlement(tier) {
  return tier === "plus" || tier === "pro" ? tier : null;
}
