import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
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
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";

const HYDRATION_READY_EVENT = "kova:hydrated";

const EARLY_THEME_BOOTSTRAP = `(() => {
  try {
    const mode = localStorage.getItem("kova-theme-mode") || "system";
    const isDark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.classList.toggle("dark", isDark);
  } catch {}
})();`;

const LOCALE_DOCUMENT_BOOTSTRAP = `(() => {
  const segment = location.pathname.split("/")[1];
  const supported = new Set(["en", "es", "fr", "de", "pt-BR", "ja", "ko", "ar"]);
  if (!supported.has(segment)) return;
  document.documentElement.lang = segment;
  document.documentElement.dir = segment === "ar" ? "rtl" : "ltr";
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
  return (
    <main id="main-content" tabIndex={-1} className="kova-state-screen">
      <section className="kova-state-panel" aria-labelledby="not-found-title">
        <p className="kova-state-eyebrow">404 · KovaGPT</p>
        <h1 id="not-found-title">We couldn't find that page</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <div className="kova-state-actions">
          <Link to="/" className="kova-state-primary">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}

function ErrorComponent({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <main id="main-content" tabIndex={-1} className="kova-state-screen">
      <section className="kova-state-panel" aria-labelledby="route-error-title">
        <p className="kova-state-eyebrow">KovaGPT workspace</p>
        <h1 id="route-error-title">KovaGPT couldn't load this page</h1>
        <p>
          Something went wrong while loading this page. Retry or return home. If the problem keeps
          happening, contact support and describe what you were doing.
        </p>
        <div className="kova-state-actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await router.invalidate();
              } finally {
                reset();
              }
            }}
            className="kova-state-primary"
          >
            Retry
          </button>
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
    <html lang="en" suppressHydrationWarning data-kova-hydration="pending" aria-busy="true">
      <head>
        <HeadContent />
      </head>
      <body>
        <ScriptOnce>{EARLY_THEME_BOOTSTRAP}</ScriptOnce>
        <ScriptOnce>{LOCALE_DOCUMENT_BOOTSTRAP}</ScriptOnce>
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
    applyThemeMode(userKey === null ? loadThemeMode() : (loaded.mode ?? "system"));
  }, [isLoaded, userKey]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <ClerkProvider>
      <QueryClientProvider client={queryClient}>
        <a
          href="#main-content"
          className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <RootThemeManager />
        <PlatformRuntime />
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}
