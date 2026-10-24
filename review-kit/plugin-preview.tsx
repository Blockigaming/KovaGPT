import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  getPluginPreviewProvider,
  LAUNCH_PLUGIN_REVIEW_CATALOG,
} from "@/lib/plugin-review-catalog";
import { PluginConnectionPreview } from "./components/PluginConnectionPreview";

function PluginPreviewApp() {
  const [providerId, setProviderId] = useState(LAUNCH_PLUGIN_REVIEW_CATALOG[0].connector.id);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const provider = getPluginPreviewProvider(providerId);
  const review = LAUNCH_PLUGIN_REVIEW_CATALOG.find((item) => item.connector.id === providerId);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="min-h-dvh bg-background text-foreground [overflow-wrap:anywhere]">
      <header className="border-b bg-card/50">
        <div className="mx-auto flex min-w-0 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-lg font-semibold">KovaGPT</p>
            <p className="text-xs text-muted-foreground">Local interface review · sample data</p>
          </div>
          <div
            className="flex gap-1 rounded-xl border p-1"
            role="group"
            aria-label="Preview appearance"
          >
            {(["light", "dark"] as const).map((value) => (
              <Button
                key={value}
                variant={theme === value ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {value === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto grid min-w-0 max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <section aria-labelledby="provider-list-title" className="min-w-0">
          <h1 id="provider-list-title" className="text-2xl font-semibold">
            Connection previews
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Explore the consent and connection states for all {LAUNCH_PLUGIN_REVIEW_CATALOG.length}{" "}
            launch providers.
          </p>
          <label className="mt-5 block text-sm font-medium" htmlFor="preview-provider">
            Select provider
          </label>
          <select
            id="preview-provider"
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm"
            value={providerId}
            onChange={(event) => {
              setOpen(false);
              setProviderId(event.target.value);
              setSession((value) => value + 1);
            }}
          >
            {LAUNCH_PLUGIN_REVIEW_CATALOG.map(({ connector }) => (
              <option key={connector.id} value={connector.id}>
                {connector.label}
              </option>
            ))}
          </select>
          <div
            className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1"
            role="group"
            aria-label="Launch providers"
          >
            {LAUNCH_PLUGIN_REVIEW_CATALOG.map((entry) => (
              <button
                type="button"
                key={entry.connector.id}
                aria-pressed={providerId === entry.connector.id}
                className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${providerId === entry.connector.id ? "bg-accent font-medium" : "bg-card/40"}`}
                onClick={() => {
                  setOpen(false);
                  setProviderId(entry.connector.id);
                  setSession((value) => value + 1);
                }}
              >
                {entry.brandAsset.src && (
                  <img
                    src={entry.brandAsset.src}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-1"
                  />
                )}
                <span className="min-w-0">{entry.connector.label}</span>
              </button>
            ))}
          </div>
        </section>
        {provider && review && (
          <section aria-labelledby="provider-preview-title" className="min-w-0 space-y-5">
            <div className="rounded-2xl border bg-card/40 p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Connection preview · sample data
              </p>
              <div className="mt-3 flex items-center gap-3">
                {review.brandAsset.src && (
                  <img
                    src={review.brandAsset.src}
                    alt=""
                    className="h-10 w-10 shrink-0 object-contain"
                  />
                )}
                <h2 id="provider-preview-title" className="text-2xl font-semibold">
                  {provider.label}
                </h2>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{provider.description}</p>
              <p className="mt-4 rounded-xl border bg-muted/40 p-3 text-sm">
                This standalone review changes local sample state only. It does not sign in, request
                permissions, connect accounts, or access provider data.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button ref={trigger} onClick={() => setOpen(true)}>
                  Open connection preview
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSession((value) => value + 1);
                    setOpen(true);
                  }}
                >
                  Reset and open preview
                </Button>
              </div>
            </div>
            <div className="rounded-2xl border p-5">
              <h3 className="font-semibold">What to try</h3>
              <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                <li>Review read and write capabilities and select sample permissions.</li>
                <li>Choose success, permission denied, failure, or cancellation.</li>
                <li>Retry, simulate an expired connection, or confirm a sample disconnect.</li>
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">{provider.availabilityNote}</p>
            </div>
            <PluginConnectionPreview
              key={`${providerId}:${session}`}
              provider={provider}
              open={open}
              onOpenChange={setOpen}
              returnFocusRef={trigger}
            />
          </section>
        )}
      </main>
    </div>
  );
}

const root = document.getElementById("plugin-preview-root") ?? document.getElementById("root");
if (!root) throw new Error("Missing plugin preview mount element.");
createRoot(root).render(<PluginPreviewApp />);
