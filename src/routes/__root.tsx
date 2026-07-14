import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { ClerkProvider } from "@/components/auth/ClerkSafe";
import { Toaster } from "@/components/ui/sonner";

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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong on our end.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { httpEquiv: "Accept-CH", content: "Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA, Sec-CH-Viewport-Width, Sec-CH-DPR" },
      { name: "format-detection", content: "telephone=no" },
      { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#0a0a0a", media: "(prefers-color-scheme: dark)" },
      { name: "color-scheme", content: "light dark" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "application-name", content: "KovaGPT" },
      { name: "author", content: "KovaGPT" },
      { property: "og:site_name", content: "KovaGPT" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "google-site-verification", content: "VTjXtk11HpoepIygAjJgPmMXb6NZ8iCBzFyJE0IP1zM" },
      { title: "KovaGPT" },
      { property: "og:title", content: "KovaGPT" },
      { name: "twitter:title", content: "KovaGPT" },
      { name: "description", content: "KovaGPT is an advanced multimodal AI assistant for intelligent conversations, research, and creative work." },
      { property: "og:description", content: "KovaGPT is an advanced multimodal AI assistant for intelligent conversations, research, and creative work." },
      { name: "twitter:description", content: "KovaGPT is an advanced multimodal AI assistant for intelligent conversations, research, and creative work." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "alternate icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://accounts.google.com" },
      { rel: "dns-prefetch", href: "https://accounts.google.com" },
      { rel: "preconnect", href: "https://js.stripe.com" },
      { rel: "dns-prefetch", href: "https://js.stripe.com" },
      { rel: "preconnect", href: "https://api.stripe.com" },
      { rel: "preconnect", href: "https://m.stripe.network" },
      { rel: "preconnect", href: "https://zrzwkqrwurgutrmvalri.supabase.co" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },

    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "KovaGPT",
              url: "https://kovagpt.com",
              logo: "https://kovagpt.com/favicon.png",
            },
            {
              "@type": "WebSite",
              name: "KovaGPT",
              url: "https://kovagpt.com",
            },
          ],
        }),
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Apply theme before hydration to avoid flash + match system on every route. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('kova-theme-mode')||'system';function isDark(mode){return mode==='dark'||(mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}function apply(mode){var d=isDark(mode);document.documentElement.classList.toggle('dark',d);var color=d?'#2a2a2e':'#f4f4f6';var metas=document.querySelectorAll('meta[name="theme-color"]');if(metas.length===0){var el=document.createElement('meta');el.setAttribute('name','theme-color');document.head.appendChild(el);metas=[el];}metas.forEach(function(el){el.removeAttribute('media');el.setAttribute('content',color);});}apply(m);if(m==='system'&&window.matchMedia){var mq=window.matchMedia('(prefers-color-scheme: dark)');mq.addEventListener&&mq.addEventListener('change',function(){if((localStorage.getItem('kova-theme-mode')||'system')==='system')apply('system');});}var mo=new MutationObserver(function(){apply(localStorage.getItem('kova-theme-mode')||'system');});mo.observe(document.documentElement,{attributes:true,attributeFilter:['class']});}catch(e){}})();`,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <ClerkProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}
