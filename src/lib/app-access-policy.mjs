const PRIVATE_ROOTS = new Set([
  "apps",
  "library",
  "projects",
  "scheduled-tasks",
  "settings",
  "profile",
  "billing",
  "discovery",
  "search",
  "images",
  "work",
  "agent",
  "code-helper",
  "writing",
  "study",
  "audit-log",
  "share-inbox",
  "memory",
  "maps",
  "voice",
  "notifications",
  "trusted-contacts",
  "brain",
  "organization",
  "kovas",
  "context-packs",
  "files",
  "goals",
  "knowledge-graph",
  "summary",
  "connect",
  "research-assistant",
  "ai-image-generator",
  "ai-writer",
  "ai-humanizer",
  "humanize-ai-text",
  "translate",
  "assistants",
  "canvas",
  "skills",
  "timers",
  "developer",
  "admin",
  "omega",
  "prompt-studio",
  "sites",
  "write",
  "checkout",
]);

// These exact routes contain read-only product information and links to the
// authenticated app. Their tool workspaces and connection actions stay private.
const PUBLIC_INFORMATION_PATHS = new Set([
  "/connect",
  "/ai-writer",
  "/ai-image-generator",
  "/ai-humanizer",
  "/humanize-ai-text",
  "/apps/google-drive",
  "/apps/gmail",
  "/apps/google-calendar",
  "/apps/github",
  "/apps/canva",
  "/apps/powerpoint",
  "/apps/spotify",
]);

/** Public information and shared read-only links remain reachable; using the app requires an account. */
export function requiresAppAccount(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return true;
  const path = pathname.split(/[?#]/u, 1)[0];
  if (PUBLIC_INFORMATION_PATHS.has(path)) return false;
  return (
    path === "/" ||
    PRIVATE_ROOTS.has(path.split("/")[1]) ||
    /^\/developers\/(?:console|connections|authorize)(?:\/|$)/u.test(path)
  );
}
