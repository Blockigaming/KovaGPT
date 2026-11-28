export function prepareKeyCredential(
  provider: string,
  input: Record<string, unknown>,
): { token: string; accountId: string; labelSuffix: string; addedScopes?: string[] };
export function unpackKeyCredential(
  provider: "notion-private",
  token: string,
): { apiKey: string; pageId: string };
export function unpackKeyCredential(
  provider: "vercel",
  token: string,
): { apiKey: string; teamId: string };
export function unpackKeyCredential(
  provider: "mixpanel",
  token: string,
): {
  apiKey: string;
  username: string;
  projectId: string;
  workspaceId: string;
  region: "us" | "eu" | "in";
};
export function unpackKeyCredential(
  provider: "wix",
  token: string,
): { apiKey: string; clientId: string };
export const WEBULL_ORIGINS: Readonly<{ production: string; sandbox: string }>;
export function unpackKeyCredential(
  provider: "webull",
  token: string,
): {
  apiKey: string;
  appKey: string;
  accessToken: string;
  environment: keyof typeof WEBULL_ORIGINS;
};
export function unpackKeyCredential(
  provider: "etoro",
  token: string,
): { apiKey: string; userKey: string };
export function unpackKeyCredential(
  provider: "custom-mcp",
  token: string,
): { apiKey: string; serverId: string; bindingHash: string; writeFingerprint?: string };
