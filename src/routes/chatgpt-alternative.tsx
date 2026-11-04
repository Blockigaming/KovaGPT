import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/chatgpt-alternative")({
  beforeLoad: () => {
    throw redirect({ to: "/kovagpt-alternative" as never, statusCode: 301, replace: true });
  },
});
