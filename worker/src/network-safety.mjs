import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function parseIpv4(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPrivateAddress(rawAddress) {
  const address = String(rawAddress)
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = parseIpv4(mapped ?? address);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) !== 6) return false;
  if (address === "::" || address === "::1") return true;
  const [firstText, secondText = "0"] = address.split(":"),
    first = Number.parseInt(firstText || "0", 16),
    second = Number.parseInt(secondText || "0", 16);
  // Only globally routable IPv6 unicast space (2000::/3) is accepted. This
  // conservatively blocks unspecified, mapped IPv4, link-local, unique-local,
  // multicast, documentation, and other special-use ranges.
  return (
    first < 0x2000 ||
    first > 0x3fff ||
    (first === 0x2001 && (second < 0x0200 || second === 0x0db8)) ||
    first === 0x3fff
  );
}

export async function assertPublicUrl(raw, resolver = dnsLookup) {
  const target = new URL(raw);
  if (target.protocol !== "http:" && target.protocol !== "https:")
    throw new Error("Only HTTP(S) navigation is allowed");
  if (target.username || target.password) throw new Error("URL credentials are not allowed");
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
    throw new Error("Private network navigation is blocked");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error("Private network navigation is blocked");
  return target.toString();
}
