export type KovaChatFamilyId = "cosmo" | "orion";
export type KovaChatEffortId = "light" | "medium" | "high" | "extra-high" | "max" | "ultra";
export type KovaChatRoute = Readonly<{
  routeId: string;
  familyId: KovaChatFamilyId;
  familyLabel: string;
  effortId: KovaChatEffortId;
  effortLabel: string;
  engine: "kova-core" | "kova-ultra";
  passes: readonly [number, number, number, number] | null;
  outputCeiling: number;
}>;
export const KOVA_CHAT_FAMILIES: readonly Readonly<{
  id: KovaChatFamilyId;
  label: string;
}>[];
export const KOVA_CHAT_EFFORTS: readonly Readonly<{
  id: KovaChatEffortId;
  label: string;
  engine: "kova-core" | "kova-ultra";
  passes: readonly [number, number, number, number] | null;
  outputCeiling: number;
}>[];
export const KOVA_CHAT_ROUTES: readonly KovaChatRoute[];
export function parseKovaChatSelection(input: unknown): Readonly<{
  family: KovaChatFamilyId;
  effort: KovaChatEffortId;
  routeId: string;
}>;
export function kovaModelsChatSelection(input: unknown): Readonly<{
  schema_version: "kova-models.v2";
  surface: "chat";
  family: KovaChatFamilyId;
  effort: "Light" | "Medium" | "High" | "Extra High" | "Max" | "Ultra";
}>;
export function kovaChatOptionsForTier(
  tier: "guest" | "free" | "plus" | "pro",
): readonly Readonly<KovaChatRoute & { entitled: boolean; runtimeVerified: false }>[];
export function authorizeKovaChatSelection(
  input: unknown,
  context: {
    tier: "guest" | "free" | "plus" | "pro";
    allowedRoutes: Set<string>;
    runtimeRoutes: Set<string>;
  },
): KovaChatRoute;
