import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, RefreshCw, ExternalLink, Upload, Download } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { SITE_LIMITS, siteUuid } from "@/lib/sites-policy.mjs";
import {
  siteRequest,
  siteError,
  SiteRequestError,
  type SiteMutation,
  type SiteWorkspace,
} from "@/lib/sites-client";

export default function SitesPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <WorkspacePageHeader
          icon={Globe}
          title="Sites"
          description="Save versioned site files, then publish privately or share them with others."
        />
        {!isLoaded ? (
          <p role="status">Loading account…</p>
        ) : isSignedIn && user ? (
          <SitesContent key={user.id} userId={user.id} />
        ) : (
          <div className="rounded-xl border p-6">
            <p className="mb-3">Sign in to create Sites or open one shared with you.</p>
            <SignInButton />
          </div>
        )}
      </main>
    </AppShell>
  );
}
function SitesContent({ userId }: { userId: string }) {
  const [index, setIndex] = useState<SiteWorkspace | null>(null),
    [workspace, setWorkspace] = useState<SiteWorkspace | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [version, setVersion] = useState<string | null>(null);
  const [title, setTitle] = useState(""),
    [slug, setSlug] = useState(""),
    [email, setEmail] = useState(""),
    [workId, setWorkId] = useState(""),
    [openId, setOpenId] = useState(() => {
      try {
        return new URL(location.href).searchParams.get("open") ?? "";
      } catch {
        return "";
      }
    });
  const [html, setHtml] = useState(
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>My Site</title></head>\n<body><h1>My Site</h1></body>\n</html>',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [retry, setRetry] = useState<SiteMutation | null>(null),
    [confirm, setConfirm] = useState<"delete" | "public" | null>(null);
  const controller = useRef(new AbortController()),
    epoch = useRef(0),
    picker = useRef<HTMLInputElement>(null);
  const refresh = useCallback(
    async (id: string | null) => {
      const current = ++epoch.current;
      setError(null);
      setWorkspace(null);
      setSelected(id);
      setVersion(null);
      setRetry(null);
      setConfirm(null);
      try {
        const list = await siteRequest(userId, "/api/sites", controller.current.signal);
        if (current !== epoch.current || controller.current.signal.aborted) return;
        setIndex(list);
        if (!id) return;
        const data = await siteRequest(
          userId,
          `/api/sites?siteId=${id}`,
          controller.current.signal,
        );
        if (current !== epoch.current || controller.current.signal.aborted) return;
        setWorkspace(data);
        setVersion(data.site?.published_version_id ?? data.versions?.[0]?.id ?? null);
        setTitle(data.site?.title ?? "");
        setSlug(data.site?.slug ?? "");
      } catch (cause) {
        if (!controller.current.signal.aborted && current === epoch.current)
          setError(siteError(cause));
      }
    },
    [userId],
  );
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void refresh(null);
    return () => active.abort();
  }, [refresh]);
  const site = workspace?.site?.id === selected ? workspace.site : null;
  async function submit(body: SiteMutation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setRetry(null);
    try {
      const result = (await siteRequest(userId, "/api/sites", controller.current.signal, body)) as {
        result?: { siteId?: string };
      };
      if (controller.current.signal.aborted) return;
      if (typeof result.result?.siteId !== "string") throw new Error("site_response_invalid");
      setNotice("Site changes saved.");
      await refresh(body.action === "delete" ? null : result.result.siteId);
    } catch (cause) {
      if (controller.current.signal.aborted) return;
      setError(siteError(cause));
      if (!(cause instanceof SiteRequestError) || cause.status >= 500) setRetry(body);
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  function mutate(action: string, payload: Record<string, unknown>) {
    if (!site || busy) return;
    void submit({
      action,
      siteId: site.id,
      revision: site.revision,
      mutationId: crypto.randomUUID(),
      payload,
    });
  }
  async function open(preview = false, id = site?.id) {
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      siteUuid(id);
      const data = await siteRequest(userId, "/api/sites", controller.current.signal, {
        action: "ticket",
        siteId: id,
        payload: preview ? { versionId: version } : {},
      });
      if (controller.current.signal.aborted) return;
      if (!data.url || !data.url.startsWith("https://")) throw Error();
      window.location.assign(data.url);
    } catch (cause) {
      if (!controller.current.signal.aborted) setError(siteError(cause));
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!site || busy || !files?.length) return;
    const current = site,
      currentEpoch = epoch.current;
    setError(null);
    try {
      if (files.length > SITE_LIMITS.files) throw Error();
      let entries: { path: string; base64: string }[] = [];
      let bytes = 0;
      const packageFile = files.length === 1 && files[0].name.endsWith(".kova-site.json");
      if (packageFile) {
        if (files[0].size > SITE_LIMITS.bodyBytes) throw Error();
        const data = JSON.parse(await files[0].text());
        if (data?.format !== "kova-site-files" || data.version !== 1 || !Array.isArray(data.files))
          throw Error();
        entries = data.files;
      }
      const selectedFiles = packageFile ? [] : Array.from(files);
      for (const file of selectedFiles) {
        bytes += file.size;
        if (file.size > SITE_LIMITS.fileBytes || bytes > SITE_LIMITS.versionBytes) throw Error();
        const data = new Uint8Array(await file.arrayBuffer());
        if (controller.current.signal.aborted) return;
        let binary = "";
        for (let i = 0; i < data.length; i += 8192)
          binary += String.fromCharCode(...data.subarray(i, i + 8192));
        entries.push({ path: file.name, base64: btoa(binary) });
      }
      if (controller.current.signal.aborted || currentEpoch !== epoch.current) return;
      void submit({
        action: "saveVersion",
        siteId: current.id,
        revision: current.revision,
        mutationId: crypto.randomUUID(),
        payload: { versionId: crypto.randomUUID(), files: entries },
      });
    } catch {
      setError(
        "Select up to 64 supported files, including index.html. Each file can be up to 2 MB; a version can be up to 8 MB.",
      );
    }
  }
  async function download() {
    if (!site || !version || busy) return;
    setBusy(true);
    try {
      const data = await siteRequest(
        userId,
        `/api/sites?siteId=${site.id}&versionId=${version}`,
        controller.current.signal,
      );
      if (controller.current.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob(
          [JSON.stringify({ format: "kova-site-files", version: 1, files: data.files }, null, 2)],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${site.slug}.kova-site.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.current.signal.aborted) setError(siteError(cause));
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="space-y-5" aria-busy={busy}>
      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
          <p>{error}</p>
          {retry && (
            <Button
              className="mt-2"
              disabled={busy}
              variant="outline"
              onClick={() => void submit(retry)}
            >
              Retry the same request
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {index && !index.hostingReady && (
        <div className="rounded-xl border bg-muted/30 p-4 text-sm">
          Site files can be saved privately. Preview and publishing will be available when Site
          hosting is activated.
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <label className="min-w-60 flex-1 text-sm">
          Open a shared Site
          <Input
            aria-label="Shared Site ID"
            className="mt-1"
            value={openId}
            onChange={(e) => setOpenId(e.target.value)}
            placeholder="Site ID"
          />
        </label>
        <Button
          disabled={busy || !index?.hostingReady || !openId}
          onClick={() => void open(false, openId)}
        >
          Open Site
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void refresh(selected)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-2">
          <Button
            className="w-full"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refresh(null);
              setTitle("");
              setSlug("");
            }}
          >
            New Site
          </Button>
          {!index ? (
            <p role="status">Loading Sites…</p>
          ) : index.sites?.length ? (
            index.sites.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                className={`w-full rounded-xl border p-3 text-left ${selected === item.id ? "bg-muted" : "hover:bg-muted/50"}`}
                onClick={() => void refresh(item.id)}
              >
                <span className="block font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {item.published_version_id
                    ? item.visibility === "public"
                      ? "Public"
                      : "Private publication"
                    : "Unpublished"}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Your saved Sites will appear here.</p>
          )}
        </aside>
        <section className="space-y-5 rounded-2xl border p-5">
          {selected && !site ? (
            <p role="status">Loading Site…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Title
                  <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="text-sm">
                  URL name
                  <Input
                    value={slug}
                    maxLength={60}
                    placeholder="my-site"
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </label>
              </div>
              <Button
                disabled={busy || !title.trim() || !slug}
                onClick={() =>
                  site
                    ? mutate("rename", { title, slug })
                    : void submit({
                        action: "create",
                        siteId: crypto.randomUUID(),
                        mutationId: crypto.randomUUID(),
                        revision: 0,
                        payload: { title, slug },
                      })
                }
              >
                {site ? "Save title and URL name" : "Create private Site"}
              </Button>
              {site && (
                <>
                  <p className="break-all text-xs text-muted-foreground">
                    Site ID: {site.id}. Earlier URL names redirect to the current name while the
                    Site remains accessible.
                  </p>
                  <div className="space-y-3 border-t pt-5">
                    <h2 className="font-semibold">Save a version</h2>
                    <p className="text-sm text-muted-foreground">
                      Upload index.html and its assets, restore a downloaded .kova-site.json file,
                      or save an HTML page below. Versions are kept separately.
                    </p>
                    <input
                      ref={picker}
                      className="hidden"
                      type="file"
                      multiple
                      onChange={(e) => {
                        void upload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => picker.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload site files
                    </Button>
                    <label className="block text-sm">
                      index.html
                      <Textarea
                        className="mt-1 min-h-48 font-mono text-sm"
                        value={html}
                        maxLength={SITE_LIMITS.fileBytes}
                        onChange={(e) => setHtml(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={busy || !html}
                      onClick={() => {
                        const bytes = new TextEncoder().encode(html);
                        let binary = "";
                        for (let i = 0; i < bytes.length; i += 8192)
                          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                        mutate("saveVersion", {
                          versionId: crypto.randomUUID(),
                          files: [{ path: "index.html", base64: btoa(binary) }],
                        });
                      }}
                    >
                      Save HTML version
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="max-w-sm"
                        aria-label="Work HTML deliverable ID"
                        placeholder="Work HTML deliverable ID"
                        value={workId}
                        onChange={(e) => setWorkId(e.target.value)}
                      />
                      <Button
                        disabled={busy || !workId}
                        variant="outline"
                        onClick={() =>
                          mutate("importWork", {
                            deliverableId: workId,
                            versionId: crypto.randomUUID(),
                          })
                        }
                      >
                        Import verified Work HTML
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3 border-t pt-5">
                    <h2 className="font-semibold">Versions and publishing</h2>
                    {workspace?.versions?.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name="site-version"
                          checked={version === item.id}
                          onChange={() => setVersion(item.id)}
                          disabled={busy}
                        />
                        <span className="flex-1">
                          {new Date(item.created_at).toLocaleString()} · {item.file_count} files ·{" "}
                          {Math.ceil(item.size_bytes / 1024)} KB
                          {site.published_version_id === item.id ? " · Published" : ""}
                        </span>
                      </label>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy || !version || !index?.hostingReady}
                        onClick={() => void open(true)}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Preview version
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !version}
                        onClick={() => void download()}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download files
                      </Button>
                      <Button
                        disabled={busy || !version || !index?.hostingReady}
                        onClick={() =>
                          mutate("publish", { versionId: version, visibility: "private" })
                        }
                      >
                        Publish privately
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !version || !index?.hostingReady}
                        onClick={() => setConfirm("public")}
                      >
                        Publish publicly
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !site.published_version_id || !index?.hostingReady}
                        onClick={() => void open()}
                      >
                        Open publication
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !site.published_version_id}
                        onClick={() => mutate("unpublish", {})}
                      >
                        Unpublish
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !version || version === site.published_version_id}
                        onClick={() => mutate("retireVersion", { versionId: version })}
                      >
                        Retire selected version
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3 border-t pt-5">
                    <h2 className="font-semibold">Private viewers</h2>
                    <p className="text-sm text-muted-foreground">
                      Grant access to an existing verified account. Revocation takes effect on the
                      next file request.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="max-w-sm"
                        aria-label="Viewer email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="person@example.com"
                      />
                      <Button
                        variant="outline"
                        disabled={busy || !email}
                        onClick={() => mutate("grantViewer", { email })}
                      >
                        Grant viewer access
                      </Button>
                    </div>
                    {workspace?.viewers?.map((viewer) => (
                      <div
                        key={viewer.viewer_id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span className="break-all">{viewer.viewer_label}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutate("revokeViewer", { viewerId: viewer.viewer_id })}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => setConfirm("delete")}
                  >
                    Delete Site
                  </Button>
                </>
              )}
            </>
          )}
        </section>
      </div>
      <ConfirmActionDialog
        open={confirm !== null}
        onOpenChange={(value) => {
          if (!value) setConfirm(null);
        }}
        title={confirm === "delete" ? "Delete this Site?" : "Publish this version publicly?"}
        description={
          confirm === "delete"
            ? "Published links will stop working immediately. Saved versions will be removed and storage released."
            : "Anyone with the link can read this version. Check that its files contain no private information."
        }
        confirmLabel={confirm === "delete" ? "Delete Site" : "Publish publicly"}
        destructive={confirm === "delete"}
        disabled={busy}
        onConfirm={() => {
          if (confirm === "delete") mutate("delete", {});
          else mutate("publish", { versionId: version, visibility: "public" });
          setConfirm(null);
        }}
      />
    </div>
  );
}
