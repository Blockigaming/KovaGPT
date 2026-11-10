/**
 * Workspace discovery must be based on an authoritative verified organization
 * association, not on the shape of an email address alone.
 *
 * This is a pure presentation gate. Server-side request handlers MUST repeat
 * all checks against current membership, domain verification, and permissions.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "pm.me", "mail.com",
  "gmx.com", "gmx.net", "zoho.com",
]);

export function normalizedEmailDomain(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed.slice(trimmed.lastIndexOf("@") + 1);
}

/**
 * verifiedWorkspaceDomains must come from an authenticated server lookup of
 * organizational workspaces with validated domain ownership. Never populate it
 * from a client-supplied list, MX guess, or a matching email suffix alone.
 */
export function canDiscoverWorkspaces({ email, emailVerified, verifiedWorkspaceDomains } = {}) {
  const domain = normalizedEmailDomain(email);
  if (!emailVerified || !domain || PERSONAL_DOMAINS.has(domain)) return false;
  if (!Array.isArray(verifiedWorkspaceDomains)) return false;
  return verifiedWorkspaceDomains.some(
    (entry) => typeof entry === "string" && entry.trim().toLowerCase() === domain,
  );
}
