import { createFileRoute, redirect, notFound } from "@tanstack/react-router";
const safe = /^[a-zA-Z0-9_-]{6,128}$/;
export const Route = createFileRoute("/canvas/$documentId")({
  beforeLoad: ({ params }) => {
    if (!safe.test(params.documentId)) throw notFound();
    throw redirect({ to: "/" });
  },
});
