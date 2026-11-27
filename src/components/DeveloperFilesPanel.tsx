import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
type FileRow = {
  id: string;
  filename: string;
  byte_size: number;
  expires_at: string;
  content?: string;
};
type UploadKey = { id: string; name: string };
const uploadTypes: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
export function DeveloperFilesPanel({
  userId,
  projectId,
  uploadKeys,
}: {
  userId: string;
  projectId: string;
  uploadKeys: UploadKey[];
}) {
  const [data, setData] = useState<{ data: FileRow[]; hasMore: boolean } | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<FileRow | null>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [uploadKey, setUploadKey] = useState(""),
    [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<string | null>(null);
  const uploadPending = useRef(false);
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
  const upload = async () => {
    if (uploadPending.current || busy || !uploadFile || !uploadKeys.some((k) => k.id === uploadKey))
      return;
    uploadPending.current = true;
    setBusy(true);
    setError("");
    try {
      const extension = uploadFile.name.split(".").at(-1) ?? "";
      const mimeType = uploadTypes[extension];
      if (
        !mimeType ||
        !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(txt|md|csv|json)$/.test(uploadFile.name) ||
        uploadFile.size < 1 ||
        uploadFile.size > 32768
      )
        throw new Error("Choose a supported text file of 1–32768 bytes.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await uploadFile.arrayBuffer(),
      );
      if (!active.current) return;
      uploadRequest.current ??= crypto.randomUUID();
      const params = new URLSearchParams({ project: projectId, key: uploadKey });
      const response = await fetchWithTimeoutAuthenticated(`/api/developer/files?${params}`, {
        method: "POST",
        headers: {
          "X-Kova-Expected-User": userId,
          "Content-Type": "application/json",
          "Idempotency-Key": uploadRequest.current,
        },
        body: JSON.stringify({ filename: uploadFile.name, mimeType, text }),
      });
      if (!response.ok) throw new Error("Upload rejected. Check file format, key and storage limits.");
      if (!active.current) return;
      setUploadFile(null);
      uploadRequest.current = null;
      if (uploadInput.current) uploadInput.current.value = "";
      if (page === 0) await load();
      else setPage(0);
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : "Upload could not be completed.");
    } finally {
      uploadPending.current = false;
      if (active.current) setBusy(false);
    }
  };
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
    <section
      data-ui-reference="chatgpt-settings-form"
      className="min-w-0 space-y-5 border-b border-border pb-6"
    >
      <h2 className="text-lg font-semibold">Developer files</h2>
      <p className="text-sm text-muted-foreground">
        Private text, Markdown, CSV and JSON files for this developer project. Files expire after
        30 days; your account can store up to 100 files and 2 MiB across all projects.
      </p>
      <form
        className="grid min-w-0 gap-3 border-b border-border pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <h3 className="font-medium">Upload file</h3>
        {uploadKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create an active files-scoped API key in this project to upload files.
          </p>
        ) : (
          <>
            <label className="block min-w-0 space-y-1 text-sm">
              <span>Files-scoped key</span>
              <select
                className="block min-h-11 w-full min-w-0 rounded-full border border-input bg-background px-4 text-base md:text-sm"
                value={uploadKey}
                disabled={busy}
                onChange={(event) => {
                  setUploadKey(event.target.value);
                  uploadRequest.current = null;
                }}
              >
                <option value="">Select key</option>
                {uploadKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 space-y-1 text-sm">
              <span>File (up to 32 KiB)</span>
              <Input
                ref={uploadInput}
                type="file"
                accept=".txt,.md,.csv,.json"
                disabled={busy}
                onChange={(event) => {
                  setUploadFile(event.target.files?.[0] ?? null);
                  uploadRequest.current = null;
                }}
              />
            </label>
            <Button
              type="submit"
              className="justify-self-start"
              disabled={busy || !uploadFile || !uploadKeys.some((key) => key.id === uploadKey)}
            >
              Upload
            </Button>
          </>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-3">
        {data?.data.map((file) => (
          <li
            key={file.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--kova-radius-card)] border border-border p-3 sm:p-4"
          >
            <div>
              <p>{file.filename}</p>
              <p className="text-xs text-muted-foreground">
                {file.byte_size} bytes · Expires {new Date(file.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex max-w-full flex-wrap gap-2">
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
      <div className="flex flex-wrap items-center gap-3">
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
          <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-[var(--kova-radius-output)] bg-muted p-4 text-sm">
            {preview.content}
          </pre>
        </div>
      )}
    </section>
  );
}
