import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/billing")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
