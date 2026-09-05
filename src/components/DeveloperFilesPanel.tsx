import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
type FileRow = {
  id: string;
  filename: string;
  byte_size: number;
  expires_at: string;
  content?: string;
};
export function DeveloperFilesPanel({ userId, projectId }: { userId: string; projectId: string }) {
  const [data, setData] = useState<{ data: FileRow[]; hasMore: boolean } | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<FileRow | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const active = useRef(true),
    version = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++version.current;
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/files?project=${encodeURIComponent(projectId)}&page=${page}`,
        { signal, headers: { "X-Kova-Expected-User": userId } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error("Could not load developer files.");
      if (active.current && !signal?.aborted && current === version.current) {
        setData(result);
        setError("");
      }
    },
    [userId, projectId, page],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    load(controller.signal).catch(() => {
      if (active.current && !controller.signal.aborted) setError("Could not load developer files.");
    });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [load]);
  const action = async (file: FileRow, remove: boolean) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/files?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(file.id)}`,
        { method: remove ? "DELETE" : "GET", headers: { "X-Kova-Expected-User": userId } },
      );
      const result = await response.json();
      if (!response.ok) throw new Error("File action failed.");
      if (!active.current) return;
      if (remove) {
        setDeleting(null);
        if (preview?.id === file.id) setPreview(null);
        await load();
      } else setPreview(result);
    } catch {
      if (active.current) setError("File action failed. Refresh and try again.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Developer files</h2>
      <p className="text-sm text-muted-foreground">
        Private text, Markdown, CSV and JSON files for this developer project. Upload through the
        API with a files-scoped key. Files expire after 30 days; your account can store up to 100
        files and 2 MiB across all projects.
      </p>
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-3">
        {data?.data.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <p>{file.filename}</p>
              <p className="text-xs text-muted-foreground">
                {file.byte_size} bytes · Expires {new Date(file.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void action(file, false)}>
                View
              </Button>
              {deleting === file.id ? (
                <>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void action(file, true)}
                  >
                    Confirm delete
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setDeleting(file.id)}>
                  Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data && !data.data.length && (
        <p className="text-sm text-muted-foreground">No files on this page.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={busy || page === 0}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <span>Page {page + 1}</span>
        <Button
          variant="outline"
          disabled={busy || !data?.hasMore}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void load().catch(() => setError("Could not refresh files."))}
        >
          Refresh
        </Button>
      </div>
      {preview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3>{preview.filename}</h3>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Close preview
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
            {preview.content}
          </pre>
        </div>
      )}
    </section>
  );
}
