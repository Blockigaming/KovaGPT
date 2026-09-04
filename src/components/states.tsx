import { Component, type ReactNode } from "react";
import { AlertCircle, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";

/* ---------- Online / offline ----------
   Hardened against false positives:
   - Never renders during initial hydration (avoids SSR/CSR flicker).
   - Trusts the browser's `offline` event but confirms with a real network
     probe before showing the banner (some networks/VPNs mis-report).
   - Debounces the transition so a 1-2s hiccup doesn't push layout down.
   - Auto-clears on the `online` event and on a successful probe.
*/
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 w-full bg-amber-500/95 text-amber-50 text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-2 shadow-sm animate-fade-in"
    >
      <WifiOff className="w-3.5 h-3.5" />
      You're offline. Reconnect before retrying unsaved actions.
    </div>
  );
}

/* ---------- Skeletons ---------- */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`kova-skeleton h-3 overflow-hidden rounded bg-muted ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="kova-skeleton h-8 w-8 overflow-hidden rounded-full bg-muted" />
        <SkeletonLine className="w-1/3" />
      </div>
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-4/5" />
      <SkeletonLine className="w-2/3" />
    </div>
  );
}

export function SkeletonGrid({ count = 6, minWidth = 240 }: { count?: number; minWidth?: number }) {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${minWidth}px,1fr))` }}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-3 flex items-center gap-3"
        >
          <div className="kova-skeleton h-9 w-9 overflow-hidden rounded-md bg-muted" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tip,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  tip?: string;
}) {
  return (
    <div className="kova-empty-state w-full rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center sm:p-10">
      {Icon && (
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="text-base font-medium mb-1">{title}</div>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
      {tip && <p className="mt-4 text-[11px] text-muted-foreground/80">Tip: {tip}</p>}
    </div>
  );
}

/* ---------- Error state ---------- */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="w-full rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center"
    >
      <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
        <AlertCircle className="w-5 h-5 text-destructive" />
      </div>
      <div className="text-sm font-medium mb-1">{title}</div>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">{description}</p>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Error boundary ---------- */
type EBState = { error: Error | null };

export class AppErrorBoundary extends Component<
  { children: ReactNode; fallback?: (err: Error, reset: () => void) => ReactNode },
  EBState
> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) console.error("[AppErrorBoundary]", error);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <main id="main-content" tabIndex={-1} className="kova-state-screen" data-app-error-boundary>
          <section
            className="kova-state-panel"
            role="alert"
            aria-labelledby="app-error-title"
            aria-describedby="app-error-description"
          >
            <div className="kova-state-mark" aria-hidden="true">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="kova-state-eyebrow">KovaGPT workspace</p>
            <h1 id="app-error-title">We couldn't load this workspace</h1>
            <p id="app-error-description">
              KovaGPT encountered an unexpected problem. Reload the workspace or return home, then
              try again.
            </p>
            <div className="kova-state-actions">
              <button
                type="button"
                className="kova-state-primary"
                onClick={() => window.location.reload()}
              >
                Reload workspace
              </button>
              <a className="kova-state-secondary" href="/">
                Return home
              </a>
            </div>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
