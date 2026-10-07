/** Navigation scope only. Authentication and entitlement remain server-owned. */
const roots = new Set([
  "/",
  "/c",
  "/share",
  "/projects",
  "/library",
  "/files",
  "/images",
  "/apps",
  "/scheduled-tasks",
  "/memory",
  "/pricing",
  "/auth",
  "/reset-password",
  "/privacy",
  "/terms",
  "/help",
]);
export function isCoreLaunchRoute(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  const pathname = path.split(/[?#]/, 1)[0];
  const root = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  return roots.has(root);
}
// Legacy request compatibility only; this neither selects nor activates a model.
// Models owns serving availability and the separate model/effort admission contract.
export const CORE_LAUNCH_MODE = "instant";
// Advanced workflow creation is deferred; existing source and saved records remain intact.
export const CORE_LAUNCH_ADVANCED_WORKFLOWS = false;

/** Owner-selected launch scope; the larger catalog remains preserved for later work. */
export const LAUNCH_PLUGIN_IDS = Object.freeze([
  "gmail",
  "google-calendar",
  "google-drive",
  "outlook",
  "onedrive",
  "sharepoint",
  "ms-teams",
  "notion",
  "github",
  "linear",
  "slack",
  "salesforce",
  "hubspot",
]);
