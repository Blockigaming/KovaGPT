// The isolated app preview uses HTTP. WebKit honors HTTPS upgrades even on
// loopback, unlike the other engines. Preserve every other production policy.
export function loopbackPreviewHeaders(url, headers) {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !headers["content-security-policy"]
  )
    return headers;
  return {
    ...headers,
    "content-security-policy": headers["content-security-policy"]
      .split(",")
      .map((policy) =>
        policy
          .split(";")
          .map((directive) => directive.trim())
          .filter((directive) => directive.toLowerCase() !== "upgrade-insecure-requests")
          .join(";"),
      )
      .join(","),
  };
}
