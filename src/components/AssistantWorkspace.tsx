import { lazyRouteComponent } from "@tanstack/react-router";

// Preload this same lazy component before client hydration. Otherwise an auth
// update can replace the server-rendered Suspense boundary before it hydrates.
// Keeping it outside the route match still preserves live streams across /c URLs.
export const AssistantWorkspace = lazyRouteComponent(
  () => import("@/components/ChatWorkspace"),
  "KovaGPT",
);
