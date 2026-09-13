import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
const OrganizationPage = lazy(() => import("@/components/OrganizationAdminPage"));
export const Route = createFileRoute("/organization")({
  component: () => (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading organization…
        </p>
      }
    >
      <OrganizationPage />
    </Suspense>
  ),
  head: () => ({
    meta: [{ title: "Organization · KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
