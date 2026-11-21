import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/", search: { settings: params.section }, replace: true });
  },
});
