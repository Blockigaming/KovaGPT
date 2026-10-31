import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/work")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
