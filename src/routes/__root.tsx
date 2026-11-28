import { ChatLoadingIndicator } from "@/components/StreamingStatus";
import { RouteLoading } from "@/components/RouteLoading";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  useRouterState,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  ScriptOnce,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { ClerkProvider } from "@/components/auth/ClerkSafe";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  applyThemeMode,
  DEFAULT_THEME_COLOR,
  LIGHT_THEME_COLOR,
  loadThemeMode,
  PHONE_DARK_THEME_COLOR,
  PHONE_THEME_QUERY,
  syncThemeColor,
} from "@/lib/theme";
import { loadSettings } from "@/lib/use-nova-settings";
import { isPublicIndexableRoute, robotsDirectiveForRoute } from "@/lib/seo-policy.mjs";
import { useEffect, useLayoutEffect, useRef } from "react";
import { installInputModality } from "@/lib/input-modality.mjs";
import { PlatformRuntime } from "@/components/PlatformRuntime";
import { DrawerNavigationFocus } from "@/components/DrawerNavigationFocus";
import { AppAccountGate } from "@/components/AppAccountGate";
import { HomeChatStartup } from "@/components/HomeChatStartup";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";

const HYDRATION_READY_EVENT = "kova:hydrated";

// The blocking script runs after the render-blocking app stylesheet, before UI
// markup. Change CSSOM selectors, not React-owned nodes or stylesheet text.
// applyThemeMode restores them atomically after setting the hydrated root class.
// The website keeps the desktop experience on every device; a native KovaGPT
// app shell names itself in its user agent and gets the phone-app presentation
// before first paint.
const EARLY_THEME_BOOTSTRAP = String.raw`(() => {
  try {
    if (/\bKovaGPTApp\//.test(navigator.userAgent))
      document.documentElement.setAttribute("data-kova-surface", "app");
  } catch {}
  let mode = "dark";
  try {
    const stored = localStorage.getItem("kova-theme-mode");
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
  } catch {}
  const isDark = mode === "dark" || (mode === "system" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const phone = window.matchMedia?.("${PHONE_THEME_QUERY}").matches;
  const darkColor = phone ? "${PHONE_DARK_THEME_COLOR}" : "${DEFAULT_THEME_COLOR}";
  // Own the metadata outside React, which hydrates hoisted tags by content.
  let chrome = document.querySelector('meta[name="theme-color"]');
  if (!chrome) {
    chrome = document.createElement("meta");
    chrome.name = "theme-color";
    document.head.append(chrome);
  }
  chrome.content = isDark ? darkColor : "${LIGHT_THEME_COLOR}";
  if (!isDark) return;

  const changed = [];
  const visit = (rules) => {
    for (const rule of rules) {
      if (typeof rule.selectorText === "string") {
        const original = rule.selectorText;
        const selected = original.replace(/\.dark(?![\w\\-])/g, ":root");
        if (selected !== original) {
          changed.push([rule, original]);
          rule.selectorText = selected;
        }
      }
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  window.__kovaRestoreThemeSelectors = () => {
    for (const [rule, original] of changed) rule.selectorText = original;
    delete window.__kovaRestoreThemeSelectors;
  };
  for (const sheet of document.styleSheets) {
    try { visit(sheet.cssRules); } catch {}
  }
})();`;

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
  const router = useRouter();
  const returningHome = useRef(false);

  useEffect(() => {
    if (returningHome.current || router.state.location.pathname === "/") return;
    returningHome.current = true;
    void router
      .navigate({
        to: "/",
        replace: true,
        state: (previous) => ({ ...previous, kovaMissingPage: true }),
      })
      .catch(() => {
        // Keep the manual link available if navigation fails.
        returningHome.current = false;
      });
  }, [router]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="kova-state-screen"
      data-ui-reference="chatgpt.error-state"
    >
      <section className="kova-state-panel" aria-labelledby="not-found-title">
        <p className="kova-state-eyebrow">404 · KovaGPT</p>
        <h1 id="not-found-title">This page isn’t available</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <div className="kova-state-actions">
          <Button
            type="button"
            variant="outline"
            className="kova-state-secondary"
            onClick={() => window.history.back()}
          >
            Back
          </Button>
          <Link to="/" className="kova-state-primary">
            Go to chat
          </Link>
        </div>
      </section>
    </main>
  );
}

function ErrorComponent({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="kova-state-screen"
      data-ui-reference="chatgpt.error-state"
    >
      <section className="kova-state-panel" aria-labelledby="route-error-title">
        <p className="kova-state-eyebrow">KovaGPT workspace</p>
        <h1 id="route-error-title">This page couldn’t load</h1>
        <p>
          Something went wrong while loading this page. Retry or return home. If the problem keeps
          happening, contact support and describe what you were doing.
        </p>
        <div className="kova-state-actions">
          <Button
            type="button"
            onClick={async () => {
              reset();
              try {
                await router.invalidate();
              } catch {
                // A failed route refresh must not strand the Retry control.
                window.location.reload();
              }
            }}
            className="kova-state-primary"
          >
            Retry
          </Button>
          <a href="/" className="kova-state-secondary">
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
          // The website serves the desktop experience on every device and
          // reflows it to the real screen width; it is not zoomed out from a
          // fixed desktop canvas. Pinch zoom stays available.
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        {
          httpEquiv: "Accept-CH",
          content:
            "Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA, Sec-CH-Viewport-Width, Sec-CH-DPR",
        },
        { name: "format-detection", content: "telephone=no" },
        { name: "color-scheme", content: "light dark" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { name: "application-name", content: "KovaGPT" },
        { name: "kova-build", content: import.meta.env.VITE_KOVA_BUILD_SHA || "unknown" },
        { name: "kova-supabase-url", content: SUPABASE_BROWSER_CONFIG.url || "missing" },
        {
          name: "kova-supabase-publishable-key",
          content: SUPABASE_BROWSER_CONFIG.publishableKey || "missing",
        },
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
        { rel: "manifest", href: "/manifest.webmanifest" },
        { rel: "icon", type: "image/png", sizes: "64x64", href: "/kova-favicon-20260807.png" },
        { rel: "shortcut icon", type: "image/png", href: "/kova-favicon-20260807.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/kova-touch-icon-20260807.png" },
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
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": getActiveSeoState(matches).robots,
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-kova-hydration="pending"
      data-kova-surface="web"
      aria-busy="true"
    >
      <head>
        <HeadContent />
        <ScriptOnce>{EARLY_THEME_BOOTSTRAP}</ScriptOnce>
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
  useEffect(() => {
    document.documentElement.dataset.kovaHydration = "ready";
    document.documentElement.removeAttribute("aria-busy");
    window.dispatchEvent(new Event(HYDRATION_READY_EVENT));
  }, []);

  return <>{children}</>;
}

function RootInputModality() {
  useEffect(() => installInputModality(document), []);
  return null;
}

function RootThemeManager() {
  const { isLoaded, user } = useUser();
  const userKey = user?.id ?? null;

  useLayoutEffect(() => {
    applyThemeMode(loadThemeMode());
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (loadThemeMode() === "system") applyThemeMode("system");
    };
    scheme.addEventListener("change", syncSystemTheme);
    const phoneTheme = window.matchMedia(PHONE_THEME_QUERY);
    phoneTheme.addEventListener("change", syncThemeColor);
    return () => {
      scheme.removeEventListener("change", syncSystemTheme);
      phoneTheme.removeEventListener("change", syncThemeColor);
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    // Account notices and actions must not survive a principal transition.
    toast.dismiss();
    const loaded = loadSettings(userKey, {
      migrateLegacyGuest: userKey === null,
    });
    applyThemeMode(userKey === null ? loadThemeMode() : (loaded.mode ?? "dark"));
  }, [isLoaded, userKey]);

  return null;
}

function DestinationOutlet() {
  const changingPage = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      Boolean(
        state.resolvedLocation && state.location.pathname !== state.resolvedLocation.pathname,
      ),
  });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const openingChat =
    pathname === "/" || /^\/(?:projects\/[^/]+\/chat|share)\/[^/]+$/.test(pathname);
  return changingPage ? (
    openingChat ? (
      <main id="main-content" className="flex min-h-dvh flex-col bg-background">
        <ChatLoadingIndicator transcript />
      </main>
    ) : (
      <RouteLoading />
    )
  ) : (
    <AppAccountGate>
      <Outlet />
    </AppAccountGate>
  );
}

function RootComponent() {
  useKeyboardViewport();
  const { queryClient } = Route.useRouteContext();
  const home = useRouterState({ select: (state) => state.location.pathname === "/" });
  return (
    <ClerkProvider phonePendingSurface={home ? <HomeChatStartup /> : undefined}>
      <QueryClientProvider client={queryClient}>
        <a
          href="#main-content"
          className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <DrawerNavigationFocus />
        <RootInputModality />
        <RootThemeManager />
        <PlatformRuntime />
        <DestinationOutlet />
        <Toaster />
        <MissingPageNotice />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function MissingPageNotice() {
  const { isLoaded } = useUser();
  const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });

  useEffect(() => {
    if (!isLoaded || pathname !== "/" || window.history.state?.kovaMissingPage !== true) return;
    window.history.replaceState({ ...window.history.state, kovaMissingPage: false }, "");
    toast("Sorry, this page doesn’t exist!", {
      id: "missing-page",
      description: "You’re back on the KovaGPT home page.",
      icon: <CircleAlert aria-hidden="true" />,
      duration: 6_000,
    });
  }, [isLoaded, pathname]);

  return null;
}
