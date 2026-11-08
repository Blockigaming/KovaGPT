const NONCE = /^[A-Za-z0-9+/]{22}==$/;
const GOOGLE =
  "https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.googleadservices.com https://*.googletagservices.com";

export function createCspNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/** Keep the ordinary baseline byte-for-byte when monetization is disabled. */
export function adSenseCsp(baseline, nonce) {
  if (!NONCE.test(nonce ?? "")) return baseline;
  return baseline
    .split("; ")
    .map((directive) => {
      if (directive.startsWith("script-src "))
        return `script-src 'nonce-${nonce}' 'strict-dynamic'`;
      if (directive.startsWith("base-uri ")) return "base-uri 'none'";
      if (directive.startsWith("connect-src ") || directive.startsWith("frame-src "))
        return `${directive} ${GOOGLE}`;
      return directive;
    })
    .join("; ");
}
