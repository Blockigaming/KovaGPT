/** Current Kova Chat target. Catalog and selection only; live routing stays disabled. */

import { KOVA_WORK_EFFORTS } from "./kova-work-policy.mjs";

export const KOVA_CHAT_FAMILIES = Object.freeze([
  Object.freeze({ id: "cosmo", label: "Kova Cosmo" }),
  Object.freeze({ id: "orion", label: "Kova Orion" }),
]);

export const KOVA_CHAT_EFFORTS = KOVA_WORK_EFFORTS;

export const KOVA_CHAT_ROUTES = Object.freeze(
  KOVA_CHAT_FAMILIES.flatMap((family) =>
    KOVA_CHAT_EFFORTS.map((effort) =>
      Object.freeze({
        routeId: `chat:${family.id}:${effort.id}`,
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

const ROUTE_BY_ID = new Map(KOVA_CHAT_ROUTES.map((route) => [route.routeId, route]));
const FAMILY_IDS = new Set(KOVA_CHAT_FAMILIES.map((family) => family.id));
const EFFORT_ALIASES = new Map([
  ["light", "light"],
  ["lite", "light"],
  ["medium", "medium"],
  ["high", "high"],
  ["extra-high", "extra-high"],
  ["extra_high", "extra-high"],
  ["max", "max"],
  ["ultra", "ultra"],
]);
const EFFORT_WIRE_LABELS = Object.freeze({
  light: "Light",
  medium: "Medium",
  high: "High",
  "extra-high": "Extra High",
  max: "Max",
  ultra: "Ultra",
});
const ALLOWED_BY_TIER = Object.freeze({
  guest: new Set(["chat:cosmo:light"]),
  free: new Set(["chat:cosmo:light"]),
  plus: new Set(
    KOVA_CHAT_ROUTES.filter((route) => ["light", "medium", "high"].includes(route.effortId)).map(
      (route) => route.routeId,
    ),
  ),
  pro: new Set(KOVA_CHAT_ROUTES.map((route) => route.routeId)),
});

function reject() {
  throw new Error("kova_chat_selection_invalid");
}

export function parseKovaChatSelection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, "family") ||
    !Object.prototype.hasOwnProperty.call(value, "effort") ||
    typeof value.family !== "string" ||
    !FAMILY_IDS.has(value.family) ||
    typeof value.effort !== "string" ||
    !EFFORT_ALIASES.has(value.effort)
  )
    reject();

  const effort = EFFORT_ALIASES.get(value.effort);
  return Object.freeze({
    family: value.family,
    effort,
    routeId: `chat:${value.family}:${effort}`,
  });
}

/** Form the Models v2 selection only. The receiving server must authenticate and authorize it. */
export function kovaModelsChatSelection(value) {
  const selection = parseKovaChatSelection(value);
  return Object.freeze({
    schema_version: "kova-models.v2",
    surface: "chat",
    family: selection.family,
    effort: EFFORT_WIRE_LABELS[selection.effort],
  });
}

export function kovaChatOptionsForTier(tier) {
  if (typeof tier !== "string" || !Object.prototype.hasOwnProperty.call(ALLOWED_BY_TIER, tier))
    reject();
  return Object.freeze(
    KOVA_CHAT_ROUTES.map((route) =>
      Object.freeze({
        ...route,
        // The UI names this Plus effort Thinking; the Models v2 wire value
        // stays High. Pro exposes High under its own name.
        effortLabel:
          route.effortId === "light"
            ? "Lite"
            : tier === "plus" && route.effortId === "high"
              ? "Thinking"
              : route.effortLabel,
        entitled: ALLOWED_BY_TIER[tier].has(route.routeId),
        // Catalog availability is not proof of an active, verified model.
        runtimeVerified: false,
      }),
    ),
  );
}

/** Server-built context only. This does not reserve a job or enable dispatch. */
export function authorizeKovaChatSelection(value, context) {
  const selection = parseKovaChatSelection(value);
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    Object.keys(context).some((key) => !["tier", "allowedRoutes", "runtimeRoutes"].includes(key)) ||
    typeof context.tier !== "string" ||
    !Object.prototype.hasOwnProperty.call(ALLOWED_BY_TIER, context.tier) ||
    !(context.allowedRoutes instanceof Set) ||
    !(context.runtimeRoutes instanceof Set) ||
    !ALLOWED_BY_TIER[context.tier].has(selection.routeId) ||
    !context.allowedRoutes.has(selection.routeId) ||
    !context.runtimeRoutes.has(selection.routeId)
  )
    throw new Error("kova_chat_selection_unavailable");

  return ROUTE_BY_ID.get(selection.routeId);
}
