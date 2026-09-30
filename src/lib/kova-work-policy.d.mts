export type KovaWorkFamilyId = "cosmo" | "orion" | "nova";
export type KovaWorkEffortId = "light" | "medium" | "high" | "extra-high" | "max" | "ultra";
export type KovaWorkEngine = "kova-core" | "kova-ultra";
export type KovaWorkRoute = Readonly<{
  routeId: string;
  familyId: KovaWorkFamilyId;
  familyLabel: string;
  effortId: KovaWorkEffortId;
  effortLabel: string;
  engine: KovaWorkEngine;
  passes: readonly [number, number, number, number] | null;
  outputCeiling: number;
}>;
export const KOVA_WORK_FAMILIES: readonly Readonly<{
  id: KovaWorkFamilyId;
  label: string;
}>[];
export const KOVA_WORK_EFFORTS: readonly Readonly<{
  id: KovaWorkEffortId;
  label: string;
  engine: KovaWorkEngine;
  passes: readonly [number, number, number, number] | null;
  outputCeiling: number;
}>[];
export const KOVA_WORK_ROUTES: readonly KovaWorkRoute[];
export function parseKovaWorkSelection(input: unknown): Readonly<{
  family: KovaWorkFamilyId;
  effort: KovaWorkEffortId;
  routeId: string;
}>;
export function kovaWorkOptionsForTier(
  tier: "free" | "plus" | "pro",
): readonly Readonly<KovaWorkRoute & { entitled: boolean; runtimeVerified: false }>[];
export function authorizeKovaWorkSelection(
  input: unknown,
  context: {
    tier: "plus" | "pro";
    allowedRoutes: Set<string>;
    runtimeRoutes: Set<string>;
  },
): KovaWorkRoute;
export function kovaWorkRoute(routeId: string): KovaWorkRoute | null;
