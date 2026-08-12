import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/usage")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
