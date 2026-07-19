import { Component, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ---------- Online / offline ----------
   Hardened against false positives:
   - Never renders during initial hydration (avoids SSR/CSR flicker).
   - Trusts the browser's `offline` event but confirms with a real network
     probe before showing the banner (some networks/VPNs mis-report).
   - Debounces the transition so a 1-2s hiccup doesn't push layout down.
   - Auto-clears on the `online` event and on a successful probe.
*/
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    async function probe(): Promise<boolean> {
      try {
        const res = await fetch("/favicon.svg", {
          method: "HEAD",
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        return res.ok || res.status < 500;
      } catch {
        return false;
      }
    }

    const off = () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const alive = await probe();
        if (!cancelled) setOnline(alive);
      }, 1500);
    };
    const on = () => {
      clearTimeout(debounce);
      if (!cancelled) setOnline(true);
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      off();
    }

    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

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
      You're offline. Changes will retry when you're back online.
    </div>
  );
}

/* ---------- Skeletons ---------- */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-3 rounded bg-muted animate-pulse ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
        <SkeletonLine className="w-1/3" />
      </div>
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-4/5" />
      <SkeletonLine className="w-2/3" />
    </div>
  );
}

export function SkeletonGrid({
  count = 6,
  minWidth = 240,
}: {
  count?: number;
  minWidth?: number;
}) {
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
          <div className="w-9 h-9 rounded-md bg-muted animate-pulse" />
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
    <div className="w-full rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center">
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
      {tip && (
        <p className="mt-4 text-[11px] text-muted-foreground/80">
          Tip: {tip}
        </p>
      )}
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
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="p-6">
          <ErrorState
            title="This page hit an unexpected error"
            description={this.state.error.message}
            onRetry={this.reset}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
