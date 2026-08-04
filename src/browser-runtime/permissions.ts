import { isIP } from "node:net";
import type { BrowserPermission, PermissionPolicy } from "./types";
import { runtimeError } from "./errors";

const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost") ||
    (isIP(normalized) === 4 && PRIVATE_IPV4.test(normalized)) ||
    (isIP(normalized) === 6 && /^(fc|fd|fe8|fe9|fea|feb)/i.test(normalized.replaceAll(":", "")))
  );
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
