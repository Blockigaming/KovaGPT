/** Opt in only behind an HTTPS-only ingress that replaces forwarding headers. */
export function kovaAuthRequestUrl(request, env = process.env) {
  const url = new URL(request.url);
  const configured = env.KOVA_AUTH_REVERSE_PROXY_ORIGIN;
  if (url.protocol !== "http:" || !configured) return url;
  let canonical;
  try {
    canonical = new URL(configured);
  } catch {
    return url;
  }
  if (
    canonical.protocol !== "https:" ||
    canonical.origin !== configured ||
    ![env.KOVA_AUTH_PUBLIC_ORIGIN, env.KOVA_AUTH_ORIGIN].includes(configured) ||
    url.host !== canonical.host ||
    request.headers.get("x-forwarded-proto") !== "https"
  )
    return url;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost !== null && forwardedHost !== canonical.host) return url;
  url.protocol = "https:";
  return url;
}
