import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { File, Files, HardDrive, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useUser } from "@/components/auth/ClerkSafe";
import { listMyLibrary, type LibraryItem } from "@/lib/library.functions";
import {
  addManyToContextPack,
  addToContextPack,
  continueInResearch,
  openInWork,
} from "@/lib/workspace-handoffs";
export const Route = createFileRoute("/files")({
  component: FilesPage,
  head: () => ({ meta: [{ title: "Files | KovaGPT" }, { name: "robots", content: "noindex" }] }),
});
function size(n: number | null) {
  if (!n) return "Size unavailable";
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}
function FilesPage() {
  const { isLoaded, isSignedIn } = useUser();
  const list = useServerFn(listMyLibrary);
  const [items, setItems] = useState<LibraryItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [duplicates, setDuplicates] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    list({})
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Files could not be loaded"))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, list]);
  const files = useMemo(
    () => items.filter((item) => item.item_type === "upload" || item.file_name || item.file_url),
    [items],
  );
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((file) => {
      const key = `${file.file_name ?? file.title}:${file.file_size ?? 0}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  }, [files]);
  const visible = files.filter(
    (file) =>
      `${file.title} ${file.file_name ?? ""}`.toLowerCase().includes(query.toLowerCase()) &&
      (!duplicates || duplicateKeys.has(`${file.file_name ?? file.title}:${file.file_size ?? 0}`)),
  );
  const usage = files.reduce((sum, file) => sum + (file.file_size ?? 0), 0);
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <WorkspacePageHeader
          icon={Files}
          title="Files"
          description="Search upload history, identify duplicates, and reuse durable Library files."
        />
        <section className="my-6 grid gap-3 rounded-2xl border bg-card/40 p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Stored files</div>
            <div className="text-xl font-semibold">{files.length}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Known storage usage</div>
            <div className="text-xl font-semibold">{size(usage)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Potential duplicates</div>
            <div className="text-xl font-semibold">{duplicateKeys.size}</div>
          </div>
        </section>
        <div className="mb-4 flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search files</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-xl border bg-background pl-9"
              placeholder="Search files"
            />
          </label>
          <button
            aria-pressed={duplicates}
            onClick={() => setDuplicates((v) => !v)}
            className={`min-h-10 rounded-xl border px-3 text-sm ${duplicates ? "bg-foreground text-background" : ""}`}
          >
            Duplicates
          </button>
        </div>
        {selected.length ? (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3"
            role="toolbar"
            aria-label="Selected file actions"
          >
            <span className="text-sm font-medium">{selected.length} files selected</span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected([])}
                className="min-h-10 rounded-lg px-3 text-sm hover:bg-accent"
              >
                Clear
              </button>
              <button
                onClick={() =>
                  addManyToContextPack(
                    files
                      .filter((item) => selected.includes(item.id))
                      .map((item) => ({
                        type: "file",
                        id: item.id,
                        title: item.file_name ?? item.title,
                        content: item.content_text ?? item.file_url ?? "",
                      })),
                  )
                }
                className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background"
              >
                Add selection to Context Pack
              </button>
            </div>
          </div>
        ) : null}
        {!isSignedIn && !loading ? (
          <div className="rounded-2xl border p-8 text-center">
            Sign in to see durable file history.
          </div>
        ) : loading ? (
          <div aria-label="Loading files" className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 p-4">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center">
            <HardDrive className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No files found</h2>
            <p className="text-sm text-muted-foreground">
              Upload through chat or choose an existing file from Library.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center gap-3 p-3">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id],
                    )
                  }
                  aria-label={`Select ${item.file_name ?? item.title}`}
                  className="h-4 w-4"
                />
                <File className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.file_name ?? item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.file_type ?? "File"} · {size(item.file_size)} ·{" "}
                    {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </div>
                {duplicateKeys.has(`${item.file_name ?? item.title}:${item.file_size ?? 0}`) && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                    Duplicate
                  </span>
                )}
                <div className="hidden gap-1 md:flex">
                  <button
                    onClick={() =>
                      openInWork({
                        type: "file",
                        id: item.id,
                        title: item.file_name ?? item.title,
                        content: item.content_text ?? item.file_url ?? "",
                      })
                    }
                    className="min-h-10 rounded-lg px-2 text-xs hover:bg-accent"
                  >
                    Work
                  </button>
                  <button
                    onClick={() =>
                      continueInResearch({
                        type: "file",
                        id: item.id,
                        title: item.file_name ?? item.title,
                        content: item.content_text ?? item.file_url ?? "",
                      })
                    }
                    className="min-h-10 rounded-lg px-2 text-xs hover:bg-accent"
                  >
                    Research
                  </button>
                  <button
                    onClick={() =>
                      addToContextPack({
                        type: "file",
                        id: item.id,
                        title: item.file_name ?? item.title,
                        content: item.content_text ?? item.file_url ?? "",
                      })
                    }
                    className="min-h-10 rounded-lg px-2 text-xs hover:bg-accent"
                  >
                    Add to context
                  </button>
                </div>
                <Link
                  to="/library"
                  className="min-h-10 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
