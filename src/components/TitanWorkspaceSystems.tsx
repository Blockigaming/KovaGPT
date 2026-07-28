import { useEffect, useMemo, useState } from "react";
import { Activity, Camera, Dna, History, Trash2 } from "lucide-react";
import {
  captureWorkspaceSnapshot,
  loadWorkspaceSnapshots,
  removeWorkspaceSnapshot,
  workspaceDna,
  workspaceHealth,
  type EvolutionItem,
  type WorkspaceSnapshot,
} from "@/lib/workspace-evolution";
import { useUser } from "@/components/auth/ClerkSafe";
import { platformEvents } from "@/platform/events";

type ResolvableItem = EvolutionItem & { title: string; href: string };

export function TitanWorkspaceSystems({ items }: { items: ResolvableItem[] }) {
  const { user } = useUser();
  const scope = user?.id ?? "signed-out";
  const [view, setView] = useState<"health" | "dna" | "time-machine">("health");
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>(() =>
    loadWorkspaceSnapshots(scope),
  );
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  useEffect(() => {
    setSnapshots(loadWorkspaceSnapshots(scope));
    setSelectedSnapshot(null);
  }, [scope]);
  const health = useMemo(() => workspaceHealth(items), [items]);
  const dna = useMemo(() => workspaceDna(items), [items]);
  const currentByKey = useMemo(
    () => new Map(items.map((item) => [`${item.kind}:${item.id}`, item])),
    [items],
  );
  const selected = snapshots.find((snapshot) => snapshot.id === selectedSnapshot);
  const replay = selected
    ? selected.entries
        .map((entry) => currentByKey.get(`${entry.kind}:${entry.id}`))
        .filter((item): item is ResolvableItem => Boolean(item))
    : [];
  return (
    <section className="mb-4 rounded-2xl border bg-card/35 p-3" aria-labelledby="titan-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="titan-title" className="text-sm font-semibold">
            Titan workspace systems
          </h3>
          <p className="text-xs text-muted-foreground">
            Deterministic health, evolution, and authorized replay—no generated claims.
          </p>
        </div>
        <div
          className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
          role="tablist"
          aria-label="Titan workspace systems"
        >
          {(
            [
              ["health", "Health", Activity],
              ["dna", "DNA", Dna],
              ["time-machine", "Time Machine", History],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs ${view === id ? "bg-foreground text-background" : "hover:bg-accent"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "health" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="rounded-xl bg-muted/45 p-4">
            <div className="text-xs text-muted-foreground">Health index</div>
            <div className="mt-1 text-3xl font-semibold">{health.score}</div>
            <div className="text-[11px] text-muted-foreground">Rule-based, not AI-scored</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Active", health.active],
              ["Stalled 14d+", health.stalled.length],
              ["Recent 30d", health.recent],
              ["Resource types", health.representedTypes],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border p-3">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-1 text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
          {health.stalled.length ? (
            <div className="sm:col-span-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs attention
              </h4>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {health.stalled.slice(0, 6).map((item) => {
                  const current = currentByKey.get(`${item.kind}:${item.id}`);
                  return current ? (
                    <li key={`${item.kind}:${item.id}`}>
                      <a
                        href={current.href}
                        className="block truncate rounded-lg border px-3 py-2 text-sm hover:bg-accent"
                      >
                        {current.title}
                      </a>
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : view === "dna" ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Your resource mix in the last 30 days compared with the preceding 30 days.
          </p>
          {dna.length ? (
            <ol className="mt-2 grid gap-2 sm:grid-cols-2">
              {dna.slice(0, 10).map((entry) => {
                const total = Math.max(entry.current, entry.previous, 1);
                return (
                  <li key={entry.kind} className="rounded-xl border p-3">
                    <div className="flex justify-between text-xs">
                      <span className="capitalize">{entry.kind.replaceAll("_", " ")}</span>
                      <span>
                        {entry.current}{" "}
                        <span className="text-muted-foreground">vs {entry.previous}</span>
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground"
                        style={{ width: `${(entry.current / total) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Create workspace activity to establish your DNA baseline.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[16rem_1fr]">
          <div>
            <button
              onClick={() => {
                setSnapshots(captureWorkspaceSnapshot(scope, items));
                platformEvents.publish("intelligence", "snapshot.captured", {
                  resourceCount: items.length,
                });
              }}
              disabled={!items.length}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              Capture now
            </button>
            <ol className="mt-2 space-y-1">
              {snapshots.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className={`flex items-center rounded-lg border ${selectedSnapshot === snapshot.id ? "bg-accent" : ""}`}
                >
                  <button
                    onClick={() => setSelectedSnapshot(snapshot.id)}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="block truncate text-sm font-medium">{snapshot.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.entries.length}{" "}
                      refs
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setSnapshots(removeWorkspaceSnapshot(scope, snapshot.id));
                      platformEvents.publish("intelligence", "snapshot.deleted", {
                        snapshotId: snapshot.id,
                      });
                      if (selectedSnapshot === snapshot.id) setSelectedSnapshot(null);
                    }}
                    className="m-1 p-2"
                    aria-label={`Delete ${snapshot.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
            {!snapshots.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Capture a metadata-only checkpoint. Content and titles are never stored in
                snapshots.
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border p-3">
            {selected ? (
              <>
                <h4 className="font-medium">Authorized replay</h4>
                <p className="text-xs text-muted-foreground">
                  Only resources you can still access are resolved. Revoked or deleted references
                  stay hidden.
                </p>
                <ul className="mt-2 space-y-1">
                  {replay.slice(0, 20).map((item) => (
                    <li key={`${item.kind}:${item.id}`}>
                      <a
                        href={item.href}
                        className="block truncate rounded-lg px-3 py-2 text-sm hover:bg-accent"
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
                {!replay.length ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No resources from this checkpoint are currently available.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a checkpoint to replay currently authorized resources.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
