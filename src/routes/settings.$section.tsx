import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params: { section } }) => {
    throw redirect({ to: "/", search: { settings: section }, replace: true });
  },
});
