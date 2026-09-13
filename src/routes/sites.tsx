import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
const SitesPage = lazy(() => import("@/components/SitesPage"));
export const Route = createFileRoute("/sites")({
  component: () => (
    <Suspense fallback={<p role="status">Loading Sites…</p>}>
      <SitesPage />
    </Suspense>
  ),
});
