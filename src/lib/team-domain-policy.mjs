/** Only explicitly verified, controllable organization domains may be linked to a workspace. */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "zoho.com",
]);
export function normalizeTeamDomain(value) {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || domain.length > 253 || PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null;
  if (
    !labels.every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
    return null;
  return domain;
}
