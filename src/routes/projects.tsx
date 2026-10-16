import { createFileRoute, Outlet } from "@tanstack/react-router";

// The overview is an index route. Nested project URLs always render their outlet.
export const Route = createFileRoute("/projects")({
  component: Outlet,
});
