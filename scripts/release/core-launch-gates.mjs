import { LAUNCH_PLUGIN_IDS } from "../../src/lib/core-launch-policy.mjs";

export const CORE_LAUNCH_SCOPE = "core-launch-20261007";
export const CORE_LAUNCH_REQUIRED_GATES = Object.freeze([
  "repository",
  "isolatedDatabase",
  "deployedEdge",
  "unauthenticatedSmoke",
  "authenticatedCrud",
  "ownerIsolation",
  "administratorDiagnostics",
  "stagingE2e",
  "authentication",
  "conversations",
  "projectsFiles",
  "providers",
  "storage",
  "scheduledTasks",
  "connectors",
  "settingsLegal",
]);
export const PLUGIN_OPERATIONS = Object.freeze(["connect", "read", "disconnect", "isolation"]);

// This checks the acceptance receipt. It neither executes a journey nor grants deployment authority.
export function coreLaunchBlockers(report) {
  const blockers = [];
  const scope = report?.scope;
  if (report?.schemaVersion !== 2) blockers.push("schemaVersion");
  if (!/^[a-f0-9]{40}$/.test(report?.commit ?? "")) blockers.push("commit");
  if (report?.target !== "staging") blockers.push("stagingTarget");
  if (scope?.id !== CORE_LAUNCH_SCOPE) blockers.push("scope.id");
  if (typeof scope?.paidSubscriptions !== "boolean") blockers.push("scope.paidSubscriptions");
  if (typeof scope?.imageGeneration !== "boolean") blockers.push("scope.imageGeneration");
  if (
    !Array.isArray(scope?.plugins) ||
    scope.plugins.length !== LAUNCH_PLUGIN_IDS.length ||
    new Set(scope.plugins).size !== LAUNCH_PLUGIN_IDS.length ||
    LAUNCH_PLUGIN_IDS.some((id) => !scope.plugins.includes(id))
  )
    blockers.push("scope.plugins");

  const required = [...CORE_LAUNCH_REQUIRED_GATES];
  if (scope?.paidSubscriptions === true) required.push("stripe", "accessLimits");
  if (scope?.imageGeneration === true) required.push("images", "imageCostControls");
  for (const name of required) {
    const entry = report?.entries?.[name];
    if (entry?.status !== "passed") blockers.push(`gates.${name}`);
    if (entry?.commit !== report?.commit || entry?.target !== "staging")
      blockers.push(`provenance.${name}`);
  }
  if (report?.entries?.authenticatedCrud?.cleanup !== "cleaned") blockers.push("cleanup");
  for (const id of LAUNCH_PLUGIN_IDS) {
    const plugin = report?.plugins?.[id];
    if (plugin?.commit !== report?.commit || plugin?.target !== "staging")
      blockers.push(`plugins.${id}.provenance`);
    for (const operation of PLUGIN_OPERATIONS)
      if (plugin?.[operation] !== "passed") blockers.push(`plugins.${id}.${operation}`);
  }
  return blockers;
}
