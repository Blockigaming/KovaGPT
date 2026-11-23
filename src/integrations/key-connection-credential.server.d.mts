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
