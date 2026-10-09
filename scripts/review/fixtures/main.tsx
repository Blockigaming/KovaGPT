/* eslint-disable react-refresh/only-export-components -- standalone review entry */
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
  useRouterState,
  type AnyRoute,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { KovaGPT } from "@/components/ChatWorkspace";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { applyThemeMode } from "@/lib/theme";
import { useNovaSettings, loadSettings } from "@/lib/use-nova-settings";
import { saveStoredSettings } from "@/lib/settings-storage";
import { saveConversations } from "@/lib/chat-store";
import { persistImageHistoryItem, deleteImageHistoryItem } from "@/lib/image-history";
import sampleImage from "@/assets/image-presets/watercolor.jpg";
import { Route as Library } from "@/routes/library";
import { Route as Images } from "@/routes/images";
import { Route as Projects } from "@/routes/projects";
import { Route as Project } from "@/routes/projects.$projectId";
import { Route as Tasks } from "@/routes/scheduled-tasks";
import { Route as Apps } from "@/routes/apps";
import { Route as Pricing } from "@/routes/pricing";
import { Route as Help } from "@/routes/help";
import { Route as Terms } from "@/routes/terms";
import { Route as Privacy } from "@/routes/privacy";
import { Route as Auth } from "@/routes/auth";
import { Route as Refund } from "@/routes/refund";
import { Route as Contact } from "@/routes/contact-support";
import {
  account,
  fixtureId,
  installReviewNetwork,
  populated,
  setPopulated,
  setReviewAccount,
  setReviewTheme,
  snapshot,
  subscribe,
} from "./state";

declare global {
  var __kovaReviewNavigate: ((path: string) => void) | undefined;
}
installReviewNetwork();
localStorage.setItem("kova-theme-mode", "dark");
applyThemeMode("dark");
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
function AuthReview() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      <KovaGPT />
      <AuthDialog
        key={path}
        open
        mode={path === "/sign-up" ? "sign-up" : "sign-in"}
        onOpenChange={(open) => {
          if (!open) void router.navigate({ to: "/" });
        }}
      />
    </>
  );
}
function SettingsReview() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [settings, setSettings] = useNovaSettings(account === "guest" ? null : fixtureId, true);
  return (
    <>
      <KovaGPT />
      <SettingsDialog
        key={path}
        open
        settings={settings}
        onChange={setSettings}
        initialTab={path === "/billing" ? "billing" : undefined}
        onClearAll={() => {
          void saveConversations(fixtureId, []);
        }}
        onOpenChange={(open) => {
          if (!open) void router.navigate({ to: "/" });
        }}
      />
    </>
  );
}
function ConversationReview() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return <KovaGPT routeConversationId={path.split("/")[2]} />;
}
const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Outlet />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  ),
});
const child = (route: AnyRoute, path: string, parent: AnyRoute = rootRoute) =>
  route.update({ id: path, path, getParentRoute: () => parent });
const projects = child(Projects, "/projects");
projects.addChildren([child(Project, "/$projectId", projects)]);
rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: KovaGPT }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/c/$conversationId",
    component: ConversationReview,
  }),
  ...["/settings", "/billing"].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: SettingsReview }),
  ),
  ...["/sign-in", "/sign-up"].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: AuthReview }),
  ),
  child(Library, "/library"),
  child(Images, "/images"),
  projects,
  child(Tasks, "/scheduled-tasks"),
  child(Apps, "/apps"),
  child(Pricing, "/pricing"),
  child(Help, "/help"),
  child(Terms, "/terms"),
  child(Privacy, "/privacy"),
  child(Auth, "/auth").update({ beforeLoad: undefined }),
  child(Refund, "/refund"),
  child(Contact, "/contact-support"),
]);
const router = createRouter({
  routeTree: rootRoute,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
globalThis.__kovaReviewNavigate = (to) => {
  void router.navigate({ to });
};
router.subscribe("onResolved", () => {
  document.documentElement.dataset.reviewRoute = router.state.location.pathname;
  parent.postMessage({ type: "kova-review-route", path: router.state.location.pathname }, "*");
});
function seedFixtureData(full: boolean) {
  const createdAt = Date.parse("2026-01-02T12:00:00Z");
  void saveConversations(
    fixtureId,
    full
      ? [
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "A clear project plan · fixture",
            mode: "chat",
            createdAt,
            updatedAt: createdAt,
            messages: [
              {
                id: "review-user",
                role: "user",
                content: "Help me organize a product launch.",
                createdAt,
              },
              {
                id: "review-answer",
                role: "assistant",
                content:
                  '## A simple launch plan\n\nThis is sample content for reviewing the interface.\n\n1. Define the audience and goal.\n2. Prepare the release checklist.\n3. Review feedback after launch.\n\n| Step | Owner |\n| --- | --- |\n| Design review | Team |\n| Accessibility | Team |\n\n```js\nconst nextStep = "Review together";\n```',
                createdAt,
              },
            ],
          },
        ]
      : [],
  );
  const imageId = "55555555-5555-4555-8555-555555555555";
  if (full)
    void persistImageHistoryItem(
      fixtureId,
      {
        id: imageId,
        prompt: "Watercolor style reference · fixture, not a generated result",
        imageUrl: sampleImage,
        createdAt,
      },
      20,
    ).catch(() => {});
  else void deleteImageHistoryItem(fixtureId, imageId).catch(() => {});
}
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "kova-review-control") return;
  const data = event.data;
  if (["guest", "free", "plus", "pro"].includes(data.account)) {
    seedFixtureData(populated);
    setReviewAccount(data.account);
    queryClient.clear();
  }
  if (typeof data.populated === "boolean") {
    seedFixtureData(data.populated);
    setPopulated(data.populated);
    queryClient.clear();
  }
  if (["dark", "light"].includes(data.theme)) {
    const key = account === "guest" ? null : fixtureId;
    saveStoredSettings(key, { ...loadSettings(key), mode: data.theme });
    localStorage.setItem("kova-theme-mode", data.theme);
    applyThemeMode(data.theme);
    setReviewTheme(data.theme);
  }
  if (typeof data.path === "string") void router.navigate({ to: data.path });
  if (data.back === true) router.history.back();
});
function Review() {
  const key = useSyncExternalStore(subscribe, snapshot);
  return <RouterProvider key={key} router={router} />;
}
createRoot(document.getElementById("root")!).render(<Review />);
