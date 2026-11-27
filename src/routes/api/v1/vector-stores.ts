import { createFileRoute } from "@tanstack/react-router";
import { handleDeveloperVectorStores } from "@/lib/pricing/developer-vector-stores.server";
export const Route = createFileRoute("/api/v1/vector-stores")({
  server: {
    handlers: {
      GET: ({ request }) => handleDeveloperVectorStores(request),
      POST: ({ request }) => handleDeveloperVectorStores(request),
      DELETE: ({ request }) => handleDeveloperVectorStores(request),
    },
  },
});
