import dns from "node:dns/promises";
import net from "node:net";

function parseIpv4(value) {
  const parts = String(value).split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets;
}

function privateIpv4(value) {
  const octets = parseIpv4(value);
  if (!octets) return false;
  const [a, b] = octets;
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

function privateIpv6(value) {
  const normalized = String(value).toLowerCase().split("%")[0];
  if (!normalized) return false;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/u.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) return privateIpv4(mapped);
    const words = mapped.split(":");
    if (words.length === 2) {
      const high = Number.parseInt(words[0], 16);
      const low = Number.parseInt(words[1], 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return privateIpv4(
          `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
        );
      }
    }
  }
  return false;
}

export function isPrivateAddress(value) {
  const family = net.isIP(String(value));
  if (family === 4) return privateIpv4(value);
  if (family === 6) return privateIpv6(value);
  return true;
}

function normalizedAllowlist(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("browser_allowed_domains_invalid");
  }
  const domains = values.map((value) => String(value).trim().toLowerCase());
  if (
    domains.some(
      (value) =>
        !value ||
        value.length > 253 ||
        value === "localhost" ||
        value.endsWith(".localhost") ||
        value.endsWith(".local") ||
        net.isIP(value) !== 0 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(
          value,
        ),
    )
  ) {
    throw new Error("browser_allowed_domains_invalid");
  }
  return new Set(domains);
}

export function parseAllowedHttpsUrl(raw, allowedDomains) {
  if (typeof raw !== "string" || raw.length > 2000) {
    throw new Error("browser_url_invalid");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("browser_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    net.isIP(url.hostname) !== 0
  ) {
    throw new Error("browser_url_forbidden");
  }
  const allowlist = normalizedAllowlist(allowedDomains);
  const hostname = url.hostname.toLowerCase();
  if (!allowlist.has(hostname)) throw new Error("browser_url_not_allowlisted");
  url.hash = "";
  return url;
}

async function resolvedAddresses(hostname, resolver) {
  const results = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("browser_dns_empty");
  }
  const addresses = results
    .map((entry) => (typeof entry === "string" ? entry : entry?.address))
    .filter((entry) => typeof entry === "string" && net.isIP(entry) !== 0);
  if (addresses.length !== results.length || addresses.some(isPrivateAddress)) {
    throw new Error("browser_dns_private_or_invalid");
  }
  return addresses;
}

export async function resolvePinnedPublicUrl(
  raw,
  allowedDomains,
  resolver = dns.lookup,
) {
  const url = parseAllowedHttpsUrl(raw, allowedDomains);
  const addresses = await resolvedAddresses(url.hostname, resolver);
  const pinnedAddress = addresses.find((address) => net.isIP(address) === 4) ?? addresses[0];
  return {
    url,
    hostname: url.hostname.toLowerCase(),
    pinnedAddress,
    addresses,
  };
}

export async function assertRequestRemainsSafe(raw, target, resolver = dns.lookup) {
  const next = parseAllowedHttpsUrl(raw, [target.hostname]);
  const addresses = await resolvedAddresses(next.hostname, resolver);
  if (!addresses.includes(target.pinnedAddress)) {
    throw new Error("browser_dns_binding_changed");
  }
  return next;
}
