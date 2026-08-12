import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/changelog")({
  beforeLoad: () => {
    throw redirect({ to: "/changelog" });
  },
});
