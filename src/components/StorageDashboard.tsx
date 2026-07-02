import { useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { getMyStorage, type StorageDto } from "@/utils/storage.functions";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
import { useTier } from "@/hooks/useTier";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function estimateLocalBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? "";
      total += k.length + v.length;
    }
    return total * 2; // rough UTF-16
  } catch {
    return 0;
  }
}

export function StorageDashboard({ signedIn }: { signedIn: boolean }) {
  const { tier } = useTier();
  const cap = STORAGE_LIMITS_BYTES[tier];
  const [remote, setRemote] = useState<StorageDto | null>(null);
  const [localBytes, setLocalBytes] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLocalBytes(estimateLocalBytes());
    if (!signedIn) return;
    setLoading(true);
    getMyStorage()
      .then((d) => setRemote(d))
      .catch(() => setRemote(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [signedIn]);

  const cloudBytes = remote?.bytesUsed ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round(((cloudBytes + localBytes) / cap) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Storage usage</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex items-baseline justify-between text-sm mb-2">
          <span className="font-semibold">{fmt(cloudBytes + localBytes)}</span>
          <span className="text-muted-foreground text-xs">
            of {fmt(cap)} ({tier})
          </span>
        </div>
        <Progress value={pct} className="h-2" />

        <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-muted-foreground">Cloud files</div>
            <div className="text-sm font-medium mt-1">{fmt(cloudBytes)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {remote?.libraryCount ?? 0} library items
            </div>
          </div>
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-muted-foreground">This device</div>
            <div className="text-sm font-medium mt-1">{fmt(localBytes)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Chats, drafts, preferences
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
