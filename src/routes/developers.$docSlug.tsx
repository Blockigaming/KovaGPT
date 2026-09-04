import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/developers/$docSlug")({
  loader: () => {
    throw notFound();
  },
  component: UnavailableDeveloperDoc,
});

function UnavailableDeveloperDoc() {
  return null;
}
