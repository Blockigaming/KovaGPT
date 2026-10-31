const key = "kova-plaid-link-session";
const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
export function savePlaidLinkSession(storage, owner, linkToken, expiration, now = Date.now()) {
  if (
    !ownerPattern.test(owner) ||
    typeof linkToken !== "string" ||
    !/^link-(production|sandbox)-[A-Za-z0-9-]{1,200}$/u.test(linkToken)
  )
    throw new Error("invalid_link_session");
  const expiresAt = Math.min(Date.parse(expiration), now + 15 * 60_000);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("expired_link_session");
  // Link tokens are short-lived browser SDK credentials. Bank access tokens
  // and public exchange tokens are never placed in browser storage.
  storage.setItem(key, JSON.stringify({ owner, linkToken, expiresAt }));
}
export function readPlaidLinkSession(storage, owner, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (
      !value ||
      value.owner !== owner ||
      !ownerPattern.test(owner) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now ||
      value.expiresAt > now + 15 * 60_000 ||
      typeof value.linkToken !== "string" ||
      !/^link-(production|sandbox)-[A-Za-z0-9-]{1,200}$/u.test(value.linkToken)
    )
      return null;
    return value.linkToken;
  } catch {
    return null;
  }
}
export function clearPlaidLinkSession(storage, owner) {
  try {
    if (JSON.parse(storage.getItem(key) ?? "null")?.owner === owner) storage.removeItem(key);
  } catch {
    /* malformed data is never resumed */
  }
}
