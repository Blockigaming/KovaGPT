import { OURA_SCOPES } from "./oura-metrics.mjs";

// Implemented web APIs only. Native HealthKit/Health Connect and medical-record
// systems must not be presented as active OAuth adapters.
export const HEALTH_PROVIDERS = Object.freeze({
  oura: { label: "Oura", scopes: OURA_SCOPES, metrics: ["sleep", "recovery", "activity"] },
  whoop: {
    label: "WHOOP",
    scopes: ["read:sleep", "read:recovery", "read:cycles"],
    metrics: ["sleep", "recovery", "activity"],
  },
});
