export type KovaModelFamily = "cosmo" | "orion" | "nova";
export type KovaModelIdentity = Readonly<{ id: KovaModelFamily; label: string }>;
export const KOVA_MODEL_VERSION: "4.6";
export const KOVA_MODEL_FAMILIES: readonly KovaModelIdentity[];
export function kovaModelIdentityForRole(role: string): KovaModelIdentity;
export function buildKovaModelIdentityInstructions(input: {
  role: string;
  modelId: string;
  provider: "openai" | "azure_openai";
  hasAssistantHistory: boolean;
}): string;
