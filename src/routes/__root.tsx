import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { ClerkProvider } from "@/components/auth/ClerkSafe";
import { Toaster } from "@/components/ui/sonner";
import { useUser } from "@/components/auth/ClerkSafe";
import { applyThemeMode, loadThemeMode } from "@/lib/theme";
import { loadSettings } from "@/lib/use-nova-settings";
import { isPublicIndexableRoute, robotsDirectiveForRoute } from "@/lib/seo-policy.mjs";
import { useEffect, useLayoutEffect, useState } from "react";
import { PlatformRuntime } from "@/components/PlatformRuntime";

const HYDRATION_READY_EVENT = "kova:hydrated";
const EARLY_SHORTCUT_BOOTSTRAP = `(() => {
  const pendingShortcuts = [];
  const captureShortcut = (event) => {
    const key = event.key.toLowerCase();
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.altKey ||
      (!event.metaKey && !event.ctrlKey) ||
      (key !== "k" && !(event.shiftKey && key === "o"))
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingShortcuts.push({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (pendingShortcuts.length > 4) pendingShortcuts.shift();
  };
  const replayShortcuts = () => {
    window.removeEventListener("keydown", captureShortcut, true);
    for (const shortcut of pendingShortcuts) {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        ...shortcut,
        bubbles: true,
        cancelable: true,
      }));
    }
    pendingShortcuts.length = 0;
  };
  window.addEventListener("keydown", captureShortcut, true);
  window.addEventListener("${HYDRATION_READY_EVENT}", replayShortcuts, { once: true });
})();`;

type SeoMatch = {
  pathname: string;
  status: string;
  globalNotFound?: boolean;
};

const PUBLIC_DESCRIPTION =
  "KovaGPT is an independent AI workspace with focused experiences for chat, writing, study, coding, research, and images. Availability varies by account.";

function getActiveSeoState(matches: readonly SeoMatch[]) {
  const pathname = matches.at(-1)?.pathname ?? "";
  const statuses = matches.flatMap((match) =>
    match.globalNotFound ? [match.status, "notFound"] : [match.status],
  );
  return {
    indexable: isPublicIndexableRoute(pathname, statuses),
    robots: robotsDirectiveForRoute(pathname, statuses),
  };
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4" role="main">
      <section
        className="max-w-md rounded-[var(--kova-radius-panel)] border border-border bg-card p-6 text-center shadow-sm"
        aria-labelledby="route-error-title"
      >
        <h1 id="route-error-title" className="text-xl font-semibold text-foreground">
          KovaGPT couldn't load this page
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong while loading this page. Retry or return home. If the problem keeps
          happening, contact support and describe what you were doing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await router.invalidate();
              } finally {
                reset();
              }
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Return home
          </a>
        </div>
      </section>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => {
    const { indexable, robots } = getActiveSeoState(matches);
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        {
          httpEquiv: "Accept-CH",
          content:
            "Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA, Sec-CH-Viewport-Width, Sec-CH-DPR",
        },
        { name: "format-detection", content: "telephone=no" },
        {
          name: "theme-color",
          content: "#ffffff",
          media: "(prefers-color-scheme: light)",
        },
        {
          name: "theme-color",
          content: "#0a0a0a",
          media: "(prefers-color-scheme: dark)",
        },
        { name: "color-scheme", content: "light dark" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { name: "application-name", content: "KovaGPT" },
        { name: "robots", content: robots },
        { title: "KovaGPT" },
        ...(indexable
          ? [
              { name: "author", content: "KovaGPT" },
              { property: "og:site_name", content: "KovaGPT" },
              { property: "og:type", content: "website" },
              { name: "twitter:card", content: "summary_large_image" },
              {
                name: "google-site-verification",
                content: "VTjXtk11HpoepIygAjJgPmMXb6NZ8iCBzFyJE0IP1zM",
              },
              { property: "og:title", content: "KovaGPT" },
              { name: "twitter:title", content: "KovaGPT" },
              { name: "description", content: PUBLIC_DESCRIPTION },
              { property: "og:description", content: PUBLIC_DESCRIPTION },
              { name: "twitter:description", content: PUBLIC_DESCRIPTION },
            ]
          : []),
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/png", sizes: "64x64", href: "/kova-favicon-20260807.png" },
        { rel: "shortcut icon", type: "image/png", href: "/kova-favicon-20260807.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/kova-touch-icon-20260807.png" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
        },
      ],
      scripts: indexable
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "Organization",
                    name: "KovaGPT",
                    url: "https://kovagpt.com",
                    logo: "https://kovagpt.com/kova-logo.png",
                  },
                  {
                    "@type": "WebSite",
                    name: "KovaGPT",
                    url: "https://kovagpt.com",
                  },
                ],
              }),
            },
          ]
        : [],
    };
  },
  headers: ({ matches }) => ({
    "X-Robots-Tag": getActiveSeoState(matches).robots,
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-kova-hydration="pending" aria-busy="true">
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce>{EARLY_SHORTCUT_BOOTSTRAP}</ScriptOnce>
        <HydrationInteractionGuard>{children}</HydrationInteractionGuard>
        <Scripts />
      </body>
    </html>
  );
}

function HydrationInteractionGuard({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.kovaHydration = "ready";
    document.documentElement.removeAttribute("aria-busy");
    window.dispatchEvent(new Event(HYDRATION_READY_EVENT));
  }, [hydrated]);

  return (
    <fieldset
      disabled={!hydrated}
      data-kova-interaction-guard={hydrated ? "ready" : "pending"}
      className="contents"
    >
      {children}
    </fieldset>
  );
}

function RootThemeManager() {
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;

  useLayoutEffect(() => {
    applyThemeMode(loadThemeMode());
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const loaded = loadSettings(userKey, {
      migrateLegacyGuest: userKey === null,
    });
    applyThemeMode(loaded.mode ?? "system");
  }, [isLoaded, userKey]);

  return null;
}

const PAGE_TITLES: Record<string, string> = {
  "/": "KovaGPT",
  "/pricing": "KovaGPT Billing",
  "/library": "KovaGPT Library",
  "/images": "KovaGPT Images",
  "/projects": "KovaGPT Projects",
  "/help": "KovaGPT Help",
  "/memory": "KovaGPT Memory",
  "/settings": "KovaGPT Settings",
  "/status": "KovaGPT Status",
};

function PageTitleManager() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const exact = PAGE_TITLES[pathname];
    const section = pathname.split("/").filter(Boolean)[0];
    const fallback = section
      ? `KovaGPT ${section.charAt(0).toUpperCase()}${section.slice(1)}`
      : "KovaGPT";
    document.title = exact ?? fallback;
  }, [pathname]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <ClerkProvider>
      <QueryClientProvider client={queryClient}>
        <RootThemeManager />
        <PageTitleManager />
        <PlatformRuntime />
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}
