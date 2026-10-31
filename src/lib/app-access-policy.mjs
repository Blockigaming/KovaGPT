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

/** Public information and shared read-only links remain reachable; using the app requires an account. */
export function requiresAppAccount(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return true;
  const path = pathname.split(/[?#]/u, 1)[0];
  return (
    path === "/" ||
    PRIVATE_ROOTS.has(path.split("/")[1]) ||
    /^\/developers\/(?:console|connections|authorize)(?:\/|$)/u.test(path)
  );
}
