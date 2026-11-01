import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep old bookmarks useful after retiring Discover.
export const Route = createFileRoute("/discovery")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
