export function prepareKeyCredential(
  provider: string,
  input: Record<string, unknown>,
): { token: string; accountId: string; labelSuffix: string };
export function unpackKeyCredential(
  provider: "notion-private",
  token: string,
): { apiKey: string; pageId: string };
export function unpackKeyCredential(
  provider: "vercel",
  token: string,
): { apiKey: string; teamId: string };
