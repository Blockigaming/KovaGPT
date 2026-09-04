const RESERVED_PUBLIC_SEGMENTS = new Set([
  "api",
  "oauth",
  "auth",
  "login",
  "signup",
  "billing",
  "admin",
  "share",
  "canvas",
  "chat",
  "new",
  "search",
  "images",
  "library",
  "projects",
  "settings",
  "pricing",
  "maps",
  "apps",
  "assistants",
  "developers",
  "checkout",
  "connect",
  "files",
  "memory",
  "notifications",
  "scheduled-tasks",
  "audit-log",
  "mcp",
  "supabase",
  "stripe",
  "azure",
  "reset-password",
  "unsubscribe",
]);
function firstSegment(pathname) {
  return String(pathname).split(/[?#]/, 1)[0].split("/").filter(Boolean)[0] ?? "";
}
export function isReservedPublicPath(pathname) {
  return RESERVED_PUBLIC_SEGMENTS.has(firstSegment(pathname));
}
export { RESERVED_PUBLIC_SEGMENTS };
