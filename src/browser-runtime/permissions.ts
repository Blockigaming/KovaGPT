import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { BrowserPermission, PermissionPolicy } from "./types";
import { runtimeError } from "./errors";

const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateIpAddress(address: string) {
  const normalized = address.toLowerCase().replace(/%.+$/, "");
  if (isIP(normalized) === 4) return PRIVATE_IPV4.test(normalized) || normalized === "0.0.0.0";
  if (isIP(normalized) !== 6) return false;
  const compact = normalized.replaceAll(":", "");
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    /^(fc|fd)/i.test(compact) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isPrivateIpAddress(normalized)
  );
}

async function resolvesToPrivateNetwork(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateHostname(normalized)) return true;
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  return addresses.some(({ address }) => isPrivateIpAddress(address));
}

export function requirePermission(policy: PermissionPolicy, permission: BrowserPermission) {
  if (!policy.grants.includes(permission)) {
    throw runtimeError("permission_denied", `Session does not grant ${permission}`);
  }
}

export function authorizeNavigation(policy: PermissionPolicy, rawUrl: string) {
  requirePermission(policy, "navigate");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw runtimeError("invalid_url", "Navigation requires an absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw runtimeError("unsafe_url", "Only HTTP and HTTPS navigation is permitted");
  }
  if (!policy.allowPrivateNetworks && isPrivateHostname(url.hostname)) {
    throw runtimeError("private_network_denied", "Private network navigation is not permitted");
  }
  const origin = url.origin.toLowerCase();
  if (policy.deniedOrigins?.some((entry) => entry.toLowerCase() === origin)) {
    throw runtimeError("origin_denied", "The destination origin is denied");
  }
  if (
    policy.allowedOrigins?.length &&
    !policy.allowedOrigins.some((entry) => entry.toLowerCase() === origin)
  ) {
    throw runtimeError("origin_not_allowed", "The destination origin is not allow-listed");
  }
  return url;
}

export async function authorizeNavigationRequest(policy: PermissionPolicy, rawUrl: string) {
  const url = authorizeNavigation(policy, rawUrl);
  if (!policy.allowPrivateNetworks && (await resolvesToPrivateNetwork(url.hostname))) {
    throw runtimeError("private_network_denied", "Private network navigation is not permitted");
  }
  return url;
}
