export function getDeepResearchAccess({ requested, authenticated, tier, owner }) {
  if (!requested) return { allowed: true, status: 200, error: null };
  if (!authenticated) {
    return {
      allowed: false,
      status: 401,
      error: "Sign in with an eligible paid plan to use Deep Research.",
    };
  }
  if (!owner && tier === "free") {
    return {
      allowed: false,
      status: 403,
      error: "Deep Research requires a Plus or Pro plan.",
    };
  }
  return { allowed: true, status: 200, error: null };
}
