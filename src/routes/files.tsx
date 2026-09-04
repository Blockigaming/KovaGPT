import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { File, Files, HardDrive, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { listMyLibrary, type LibraryItem } from "@/lib/library.functions";
import {
  addManyToContextPack,
  addToContextPack,
  continueInResearch,
  openInWork,
} from "@/lib/workspace-handoffs";
export const Route = createFileRoute("/files")({
  component: FilesPage,
  head: () => ({ meta: [{ title: "KovaGPT Files" }, { name: "robots", content: "noindex" }] }),
});
function formatFileSize(n: number | null) {
  if (n === null) return "Size unavailable";
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}
function FilesPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const list = useServerFn(listMyLibrary);
  const [items, setItems] = useState<LibraryItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [duplicates, setDuplicates] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [resolvedUserKey, setResolvedUserKey] = useState<string | null>(null),
    [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!isLoaded) return;

    let active = true;
    setItems([]);
    setSelected([]);
    setError(null);
    setQuery("");
    setDuplicates(false);

    if (!isSignedIn || !userKey) {
      setResolvedUserKey(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setResolvedUserKey(null);
    list({})
      .then((nextItems) => {
        if (!active) return;
        setItems(nextItems);
        setResolvedUserKey(userKey);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Files could not be loaded");
        setResolvedUserKey(userKey);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, list, reloadKey, userKey]);
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
  const isLoading =
    !isLoaded || Boolean(isSignedIn && (!userKey || loading || resolvedUserKey !== userKey));
  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        aria-busy={isLoading || undefined}
        className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6"
      >
        <WorkspacePageHeader
          icon={Files}
          title="Files"
          description="Search upload history, identify duplicates, and reuse durable Library files."
        />
        {isLoading ? (
          <section
            aria-busy="true"
            aria-labelledby="files-loading-title"
            className="mt-6 space-y-3"
          >
            <h2 id="files-loading-title" className="sr-only">
              Loading files
            </h2>
            {[1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </section>
        ) : !isSignedIn ? (
          <section
            className="mt-8 rounded-2xl border p-8 text-center"
            aria-labelledby="files-sign-in-title"
          >
            <HardDrive className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h2 id="files-sign-in-title" className="mt-3 text-lg font-semibold">
              Sign in to use Files
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Find uploads from your chats, spot duplicates, and reuse saved files across your
              workspace.
            </p>
            <SignInButton mode="modal">
              <Button className="mt-5">Sign in</Button>
            </SignInButton>
          </section>
        ) : error ? (
          <section role="alert" className="mt-6 rounded-xl border border-destructive/40 p-4">
            <h2 className="font-medium">Files could not be loaded</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your files are temporarily unavailable. Try again in a moment.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Try again
            </Button>
          </section>
        ) : (
          <>
            <section className="my-6 grid gap-3 rounded-2xl border bg-card/40 p-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Stored files</div>
                <div className="text-xl font-semibold">{files.length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Known storage usage</div>
                <div className="text-xl font-semibold">{formatFileSize(usage)}</div>
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
                type="button"
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
                    type="button"
                    onClick={() => setSelected([])}
                    className="min-h-10 rounded-lg px-3 text-sm hover:bg-accent"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
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
                        userKey,
                      )
                    }
                    className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background"
                  >
                    Add selection to Context Pack
                  </button>
                </div>
              </div>
            ) : null}
            {visible.length === 0 ? (
              <section
                className="rounded-2xl border p-10 text-center"
                aria-labelledby="files-empty-title"
              >
                <HardDrive className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <h2 id="files-empty-title" className="mt-3 font-semibold">
                  {query || duplicates ? "No matching files" : "No files yet"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {query || duplicates
                    ? "Try a different search or turn off the duplicate filter."
                    : "Upload a file in chat or save one to your Library to see it here."}
                </p>
                {query || duplicates ? (
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => {
                      setQuery("");
                      setDuplicates(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </section>
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
                        {item.file_type ?? "File"} · {formatFileSize(item.file_size)} ·{" "}
                        {new Date(item.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {duplicateKeys.has(
                      `${item.file_name ?? item.title}:${item.file_size ?? 0}`,
                    ) && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                        Duplicate
                      </span>
                    )}
                    <div className="hidden gap-1 md:flex">
                      <button
                        onClick={() =>
                          openInWork(
                            {
                              type: "file",
                              id: item.id,
                              title: item.file_name ?? item.title,
                              content: item.content_text ?? item.file_url ?? "",
                            },
                            userKey,
                          )
                        }
                        className="min-h-10 rounded-lg px-2 text-xs hover:bg-accent"
                      >
                        Work
                      </button>
                      <button
                        onClick={() =>
                          continueInResearch(
                            {
                              type: "file",
                              id: item.id,
                              title: item.file_name ?? item.title,
                              content: item.content_text ?? item.file_url ?? "",
                            },
                            userKey,
                          )
                        }
                        className="min-h-10 rounded-lg px-2 text-xs hover:bg-accent"
                      >
                        Research
                      </button>
                      <button
                        onClick={() =>
                          addToContextPack(
                            {
                              type: "file",
                              id: item.id,
                              title: item.file_name ?? item.title,
                              content: item.content_text ?? item.file_url ?? "",
                            },
                            userKey,
                          )
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
          </>
        )}
      </main>
    </AppShell>
  );
}
