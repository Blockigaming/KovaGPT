export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
]);

/** A custom domain is only a candidate; actual discovery always requires a server match. */
export function discoveryEmailDomain(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || value.indexOf("@") !== at) return null;
  const domain = value.slice(at + 1).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain)) return null;
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? null : domain;
}
