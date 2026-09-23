// Fragment credentials never become an HTTP request target. Legacy query
// credentials are removed but not accepted because they may already be logged.
export function readKovaRecoveryLink(href, mode) {
  const invalid = { owned: true, token: null, cleanPath: "/reset-password" };
  if (typeof href !== "string" || href.length > 8192) return invalid;
  let url;
  try {
    url = new URL(href);
  } catch {
    return invalid;
  }
  if (url.pathname !== "/reset-password") return invalid;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const queryToken = url.searchParams.has("token");
  const owned = queryToken || fragment.has("token") || mode === "kova";
  if (!owned) return { owned: false, token: null, cleanPath: null };
  const tokens = fragment.getAll("token");
  const token =
    (mode === "kova" || mode === "dual") &&
    !queryToken &&
    tokens.length === 1 &&
    [...fragment.keys()].every((key) => key === "token") &&
    /^[A-Za-z0-9_-]{43,128}$/u.test(tokens[0])
      ? tokens[0]
      : null;
  url.searchParams.delete("token");
  return { owned: true, token, cleanPath: `${url.pathname}${url.search}` };
}
