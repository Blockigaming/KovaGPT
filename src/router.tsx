import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AssistantWorkspace } from "./components/AssistantWorkspace";

export const getRouter = async () => {
  if (
    typeof window !== "undefined" &&
    (window.location.pathname === "/" || /^\/c\/[^/]+\/?$/u.test(window.location.pathname))
  ) {
    await AssistantWorkspace.preload?.();
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Sensible defaults: keep stable data warm, avoid refetch storms on
        // focus/reconnect, and let components opt into fresher data.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // TanStack Query owns freshness - keep router preload cache disabled.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
