export const DEVELOPER_SCOPES: readonly string[];
export function developerUuid(value: unknown): string;
export function parseDeveloperCredential(header: string | null): { token: string; keyId: string };
export function developerRequestKey(value: unknown): string;
export function parseDeveloperLimits(value: unknown): {
  request: number;
  daily: number;
  monthly: number;
  concurrent: number;
};
export function parseDeveloperInput(
  kind: string,
  input: unknown,
): {
  body: Record<string, unknown>;
  capability: "chat" | "streaming" | "image_generation" | "embeddings";
  publicModel: string;
};
