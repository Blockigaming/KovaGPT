import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/status")({
  beforeLoad: () => {
    throw redirect({ to: "/status" });
  },
});
