import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { routeTree } from "./routeTree.gen";

const getNonce = createIsomorphicFn().server(() => getRequestHeader("x-kova-csp-nonce"));

export const getRouter = () => {
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
    ssr: { nonce: getNonce() },
    context: { queryClient },
    scrollRestoration: true,
    // TanStack Query owns freshness - keep router preload cache disabled.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
