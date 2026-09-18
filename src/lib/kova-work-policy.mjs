/** Exact Kova Work product catalog. No provider call or runtime activation occurs here. */

export const KOVA_WORK_FAMILIES = Object.freeze([
  Object.freeze({ id: "cosmo", label: "Kova 5.6 Cosmo" }),
  Object.freeze({ id: "orion", label: "Kova 5.6 Orion" }),
  Object.freeze({ id: "nova", label: "Kova 5.6 Nova" }),
]);

export const KOVA_WORK_EFFORTS = Object.freeze([
  Object.freeze({
    id: "light",
    label: "Instant",
    engine: "kova-core",
    passes: Object.freeze([0, 1, 0, 0]),
    outputCeiling: 2048,
  }),
  Object.freeze({
    id: "medium",
    label: "Medium",
    engine: "kova-core",
    passes: Object.freeze([1, 1, 0, 1]),
    outputCeiling: 4096,
  }),
  Object.freeze({
    id: "high",
    label: "High",
    engine: "kova-core",
    passes: Object.freeze([1, 2, 1, 1]),
    outputCeiling: 8192,
  }),
  Object.freeze({
    id: "extra-high",
    label: "Extra High",
    engine: "kova-core",
    passes: Object.freeze([2, 3, 2, 2]),
    outputCeiling: 16384,
  }),
  Object.freeze({
    id: "max",
    label: "Max",
    engine: "kova-core",
    passes: Object.freeze([2, 4, 2, 3]),
    outputCeiling: 24576,
  }),
  Object.freeze({
    id: "ultra",
    label: "Ultra",
    engine: "kova-ultra",
    passes: null,
    outputCeiling: 32768,
  }),
]);

const FAMILY_IDS = new Set(KOVA_WORK_FAMILIES.map((family) => family.id));
const EFFORT_ALIASES = new Map([
  ["instant", "light"],
  ["light", "light"],
  ["medium", "medium"],
  ["high", "high"],
  ["extra_high", "extra-high"],
  ["extra-high", "extra-high"],
  ["max", "max"],
  ["ultra", "ultra"],
]);

export const KOVA_WORK_ROUTES = Object.freeze(
  KOVA_WORK_FAMILIES.flatMap((family) =>
    KOVA_WORK_EFFORTS.map((effort) =>
      Object.freeze({
        routeId: `work:${family.id}:${effort.id}`,
        familyId: family.id,
        familyLabel: family.label,
        effortId: effort.id,
        effortLabel: effort.label,
        engine: effort.engine,
        passes: effort.passes,
        outputCeiling: effort.outputCeiling,
      }),
    ),
  ),
);

const ROUTE_BY_ID = new Map(KOVA_WORK_ROUTES.map((route) => [route.routeId, route]));
const PAID_TIERS = new Set(["plus", "pro"]);

function reject() {
  throw new Error("kova_work_selection_invalid");
}

function normalizeEffort(value) {
  if (typeof value !== "string" || !EFFORT_ALIASES.has(value)) reject();
  return EFFORT_ALIASES.get(value);
}

export function parseKovaWorkSelection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, "family") ||
    !Object.prototype.hasOwnProperty.call(value, "effort") ||
    typeof value.family !== "string" ||
    !FAMILY_IDS.has(value.family)
  )
    reject();

  const effort = normalizeEffort(value.effort);
  return Object.freeze({
    family: value.family,
    effort,
    routeId: `work:${value.family}:${effort}`,
  });
}

export function kovaWorkOptionsForTier(tier) {
  if (typeof tier !== "string") reject();
  const entitled = PAID_TIERS.has(tier);
  if (tier !== "free" && !entitled) reject();
  return KOVA_WORK_ROUTES.map((route) =>
    Object.freeze({
      ...route,
      entitled,
      // A product entitlement is not proof that the Kova Models Work transport
      // is connected in the application. Runtime integration must set this from
      // trusted server evidence instead of silently falling back to old Work.
      runtimeVerified: false,
    }),
  );
}

/** Selection only: context must be built by authenticated server code.
 * Route eligibility is not a job reservation, budget approval or dispatch capability.
 */
export function authorizeKovaWorkSelection(value, context) {
  const selection = parseKovaWorkSelection(value);
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    Object.keys(context).some((key) => !["tier", "allowedRoutes", "runtimeRoutes"].includes(key)) ||
    !PAID_TIERS.has(context.tier) ||
    !(context.allowedRoutes instanceof Set) ||
    !(context.runtimeRoutes instanceof Set) ||
    !context.allowedRoutes.has(selection.routeId) ||
    !context.runtimeRoutes.has(selection.routeId)
  )
    throw new Error("kova_work_selection_unavailable");

  const route = ROUTE_BY_ID.get(selection.routeId);
  if (!route) reject();
  return route;
}

export function kovaWorkRoute(routeId) {
  return ROUTE_BY_ID.get(routeId) ?? null;
}
