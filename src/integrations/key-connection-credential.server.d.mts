export function prepareKeyCredential(
  provider: string,
  input: Record<string, unknown>,
): { token: string; accountId: string; labelSuffix: string };
