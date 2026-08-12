import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/api-keys")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
