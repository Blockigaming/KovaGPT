import { createHash, randomBytes } from "node:crypto";

export type ConnectorState =
  | "available"
  | "not_connected"
  | "connecting"
  | "connected"
  | "connection_expired"
  | "reauthorization_required"
  | "permission_incomplete"
  | "syncing"
  | "error"
  | "temporarily_unavailable";

export type GoogleCapability =
  "gmail.read" | "gmail.write" | "calendar.read" | "calendar.write" | "drive.read";

export const GOOGLE_SCOPE_GROUPS: Record<GoogleCapability, readonly string[]> = {
  "gmail.read": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "gmail.write": [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "calendar.read": [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar",
  ],
  "calendar.write": [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ],
  "drive.read": [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
};

export type ConnectedAccount = {
  id: string;
  userId: string;
  provider: "google";
  state: ConnectorState;
  email?: string | null;
  grantedScopes: string[];
  expiresAt?: string | null;
  lastSyncAt?: string | null;
  safeIdentity?: string | null;
};

export type OAuthStateRecord = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  userId: string;
  createdAt: string;
};

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createOAuthState(userId: string, redirectUri: string): OAuthStateRecord {
  if (!/^https?:\/\//.test(redirectUri)) throw new Error("Invalid redirect URI.");
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return {
    state: base64Url(randomBytes(24)),
    codeVerifier,
    codeChallenge,
    redirectUri,
    userId,
    createdAt: new Date().toISOString(),
  };
}

export function validateOAuthState(
  expected: OAuthStateRecord | null,
  actualState: string,
  redirectUri: string,
) {
  if (!expected || expected.state !== actualState)
    return { ok: false, error: "invalid_state" as const };
  if (expected.redirectUri !== redirectUri)
    return { ok: false, error: "invalid_redirect_uri" as const };
  if (Date.now() - new Date(expected.createdAt).getTime() > 10 * 60_000)
    return { ok: false, error: "state_expired" as const };
  return { ok: true as const, codeVerifier: expected.codeVerifier };
}

export function grantedCapabilities(scopes: string[]): GoogleCapability[] {
  const set = new Set(scopes);
  return (Object.keys(GOOGLE_SCOPE_GROUPS) as GoogleCapability[]).filter((capability) =>
    GOOGLE_SCOPE_GROUPS[capability].some((scope) => set.has(scope)),
  );
}

export function requireGoogleCapability(scopes: string[], capability: GoogleCapability) {
  const ok = GOOGLE_SCOPE_GROUPS[capability].some((scope) => scopes.includes(scope));
  return ok
    ? { ok: true as const }
    : {
        ok: false as const,
        code: "permission_incomplete" as const,
        missingCapability: capability,
        message: `Google ${capability.replace(".", " ")} permission is required.`,
      };
}

export function connectorCardState(
  account: ConnectedAccount | null,
  capability?: GoogleCapability,
): ConnectorState {
  if (!account) return "not_connected";
  if (account.state !== "connected") return account.state;
  if (account.expiresAt && new Date(account.expiresAt).getTime() < Date.now())
    return "connection_expired";
  if (capability && !requireGoogleCapability(account.grantedScopes, capability).ok)
    return "permission_incomplete";
  return "connected";
}

export function safeConnectorError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Connector request failed");
  if (/token|secret|credential|authorization|client_secret|refresh/i.test(raw))
    return "Connector authorization failed. Reconnect the app and try again.";
  return raw.slice(0, 180);
}

export type ConnectorToolName =
  | "gmail.search"
  | "gmail.read"
  | "gmail.draft"
  | "gmail.send"
  | "gmail.reply"
  | "gmail.forward"
  | "calendar.list"
  | "calendar.create"
  | "calendar.update"
  | "calendar.delete"
  | "drive.search"
  | "drive.read";

const TOOL_CAPABILITIES: Record<ConnectorToolName, GoogleCapability> = {
  "gmail.search": "gmail.read",
  "gmail.read": "gmail.read",
  "gmail.draft": "gmail.write",
  "gmail.send": "gmail.write",
  "gmail.reply": "gmail.write",
  "gmail.forward": "gmail.write",
  "calendar.list": "calendar.read",
  "calendar.create": "calendar.write",
  "calendar.update": "calendar.write",
  "calendar.delete": "calendar.write",
  "drive.search": "drive.read",
  "drive.read": "drive.read",
};

export function validateConnectorToolRequest(opts: {
  userId: string;
  account: ConnectedAccount | null;
  tool: ConnectorToolName;
  args: Record<string, unknown>;
  explicitWriteIntent?: boolean;
}) {
  if (!opts.account || opts.account.userId !== opts.userId)
    return { ok: false as const, code: "not_connected" as const };
  const required = TOOL_CAPABILITIES[opts.tool];
  const scope = requireGoogleCapability(opts.account.grantedScopes, required);
  if (!scope.ok) return scope;
  const write = required.endsWith(".write");
  if (write && !opts.explicitWriteIntent)
    return { ok: false as const, code: "confirmation_required" as const };
  const serialized = JSON.stringify(opts.args);
  if (serialized.length > 20_000)
    return { ok: false as const, code: "arguments_too_large" as const };
  return { ok: true as const, capability: required, confirmationRequired: write };
}
