import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { getMyStorage, type StorageDto } from "@/utils/storage.functions";
import { useUser } from "@/components/auth/ClerkSafe";
import { estimateAccountBrowserBytes, formatStorageBytes } from "@/lib/storage-display";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export function StorageDashboard({ signedIn }: { signedIn: boolean }) {
  const { isLoaded, user } = useUser();
  if (!isLoaded) {
    return <p role="status">Checking your account...</p>;
  }
  const ownerId = signedIn ? (user?.id ?? null) : null;
  return <AccountStorageDashboard key={ownerId ?? "guest"} ownerId={ownerId} />;
}

function AccountStorageDashboard({ ownerId }: { ownerId: string | null }) {
  const [remote, setRemote] = useState<StorageDto | null>(null);
  const [localBytes, setLocalBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(ownerId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeRef = useRef(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLocalBytes(estimateAccountBrowserBytes(ownerId));
    setRemote(null);
    setLoadError(null);
    if (!ownerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getMyStorage();
      if (activeRef.current && request === requestRef.current) setRemote(data);
    } catch {
      if (activeRef.current && request === requestRef.current) {
        setLoadError("Cloud storage could not be loaded. Try refreshing your usage.");
      }
    } finally {
      if (activeRef.current && request === requestRef.current) setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    activeRef.current = true;
    void load();
    return () => {
      // The owner-keyed child unmounts across account transitions.
      activeRef.current = false;
    };
  }, [load]);

  const cap = remote?.limitBytes ?? null;
  const percent = remote && cap !== null && cap > 0 ? (remote.bytesUsed / cap) * 100 : null;

  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <HardDrive className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Storage usage</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => void load()}
            disabled={loading}
            aria-label={loading ? "Refreshing storage usage" : "Refresh storage usage"}
            aria-busy={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading cloud storage usage...
          </p>
        ) : loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : remote ? (
          <div className="space-y-2" role="status">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm font-semibold">
                {formatStorageBytes(remote.bytesUsed)} in cloud storage
              </span>
              <span className="text-xs text-muted-foreground">
                {cap === null
                  ? "Plan limit unavailable"
                  : `of ${formatStorageBytes(cap)} (${remote.tier})`}
              </span>
            </div>
            {percent !== null && cap !== null ? (
              <Progress
                value={Math.min(100, Math.max(0, percent))}
                aria-label="Cloud storage used"
                aria-valuetext={`${formatStorageBytes(remote.bytesUsed)} of ${formatStorageBytes(cap)}`}
                className="h-2"
              />
            ) : null}
            {percent !== null && percent >= 100 ? (
              <p className="text-xs text-destructive">
                Cloud storage is full. Remove unneeded cloud items before adding more.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sign in to view cloud storage usage.</p>
        )}

        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-border/70 p-3">
            <div className="text-muted-foreground">Cloud library</div>
            <div className="mt-1 text-sm font-medium">
              {remote
                ? `${remote.libraryCount} ${remote.libraryCount === 1 ? "item" : "items"}`
                : loading
                  ? "Loading..."
                  : ownerId
                    ? "Unavailable"
                    : "Sign in to view"}
            </div>
            <p className="mt-1 leading-5 text-muted-foreground">
              Library item count. Cloud usage also includes other stored account content.
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-border/70 p-3">
            <div className="text-muted-foreground">This browser · estimate</div>
            <div className="mt-1 text-sm font-medium">
              {localBytes === null ? "Unavailable" : formatStorageBytes(localBytes)}
            </div>
            <p className="mt-1 leading-5 text-muted-foreground">
              Saved browser data for this account and shared device preferences. Excludes file
              caches and does not count toward your cloud quota.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
