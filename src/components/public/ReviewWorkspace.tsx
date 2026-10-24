import { useUser } from "@/components/auth/ClerkSafe";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PublicShell } from "./PublicShell";
import { REVIEW_PAGES, type ReviewPage } from "@/lib/review-page-content";
import { SearchablePicker } from "@/components/ui/searchable-picker";

import { ReviewFamilySurface, type ReviewDraft as Draft } from "./ReviewFamilySurface";

const empty = (page: ReviewPage): Draft => ({
  title: page.title,
  notes: "",
  audience: "Private local preview",
  mode:
    page.family === "voice"
      ? "Calm example"
      : page.family === "assistant"
        ? "Manual preview"
        : "Image",
  ratio: "1:1",
  language: "English",
  speed: "Normal",
  checked: [],
  referenceRole: "Reference",
  quality: "Original preview",
  audio: false,
  retentionDays: "",
  retentionScope: "Not selected",
  memberLabel: "",
  role: "Not selected",
  sharingPolicy: "Not selected",
  adjustment: "",
  apiInput: "",
  apiOutput: "",
  apiValidation: "",
});

const inMemoryDrafts = new Map<string, Draft>();
const directoryFilters = new Map<string, { query: string; group: string }>();

export function ReviewDirectory({ family }: { family?: string }) {
  const directoryKey = family ?? "all";
  const [query, setQuery] = useState(() => directoryFilters.get(directoryKey)?.query ?? "");
  const [group, setGroup] = useState(
    () => directoryFilters.get(directoryKey)?.group ?? directoryKey,
  );
  useEffect(() => {
    directoryFilters.set(directoryKey, { query, group });
  }, [directoryKey, query, group]);
  const pages = REVIEW_PAGES.filter(
    (page) =>
      (group === "all" || page.family === group) &&
      `${page.title} ${page.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="spec400-review">
        <p className="spec400-eyebrow">Local interface review</p>
        <h1>{family === "assistant" ? "Persistent assistant review" : "Additional page review"}</h1>
        <p className="spec400-lede">
          Explore layouts and prepare local drafts. These previews do not enable services, accept
          agreements, change an account or send data.
        </p>
        {family === "assistant" && (
          <section className="spec400-review-card spec400-assistant-overview">
            <div>
              <p className="spec400-eyebrow">Product preview</p>
              <h2>Define how your assistant should work</h2>
              <p>
                Choose instructions, review access boundaries and write repeatable tasks before
                connecting any service.
              </p>
              <div className="spec400-review-actions">
                <Link to={"/review/assistant-profile" as never}>Configure an assistant</Link>
                <Link to={"/review/assistant-teach" as never}>Preview task instructions</Link>
                <Link to="/">Open existing Chat</Link>
              </div>
            </div>
            <div>
              <h3>Available in this review</h3>
              <ul>
                <li>Local profile and instruction editing</li>
                <li>Step-by-step task preview</li>
                <li>Private draft save and restore</li>
              </ul>
              <p>
                Computer control, persistent execution, recording and template publication are not
                connected.
              </p>
            </div>
          </section>
        )}
        <div className="spec400-review-toolbar">
          <label>
            Search review pages
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder="Search by task"
            />
          </label>
          <label htmlFor="review-page-family">
            <span id="review-page-family-label">Page family</span>
            <SearchablePicker
              id="review-page-family"
              aria-labelledby="review-page-family-label"
              className="w-full !justify-between !bg-background !px-3"
              value={group}
              onValueChange={setGroup}
              searchLabel="Search page families"
              emptyText="No page families found."
              options={[
                { value: "all", label: "All families" },
                ...[
                  "voice",
                  "assistant",
                  "media",
                  "team",
                  "legal",
                  "request",
                  "infrastructure",
                  "developer",
                ].map((item) => ({ value: item, label: item })),
              ]}
            />
          </label>
        </div>
        {family === "legal" && (
          <nav className="spec400-review-actions" aria-label="Existing legal information">
            <Link to="/terms">Existing Terms</Link>
            <Link to="/privacy">Existing Privacy information</Link>
            <Link to={"/policies" as never}>Policy directory</Link>
          </nav>
        )}
        <p role="status">{pages.length} review pages</p>
        <div className="spec400-review-grid">
          {pages.map((page) => (
            <Link
              className="spec400-review-card"
              key={page.slug}
              to={`/review/${page.slug}` as never}
            >
              <span className="spec400-eyebrow">{page.family}</span>
              <h2>{page.title}</h2>
              <p>{page.summary}</p>
              <span>Open local preview →</span>
            </Link>
          ))}
        </div>
        {!pages.length && (
          <section className="spec400-review-card">
            <h2>No matching review pages</h2>
            <button
              onClick={() => {
                setQuery("");
                setGroup("all");
              }}
            >
              Clear filters
            </button>
          </section>
        )}
        {family === "assistant" && (
          <section id="download" className="spec400-review-card">
            <h2>Use the existing web app</h2>
            <p>No downloadable assistant is supplied with this review.</p>
            <Link to="/">Open KovaGPT</Link>
          </section>
        )}
      </main>
    </PublicShell>
  );
}

export function ReviewWorkspace({ page }: { page: ReviewPage }) {
  const { user, isLoaded } = useUser();
  if (!isLoaded)
    return (
      <PublicShell>
        <main id="main-content" className="spec400-review" tabIndex={-1}>
          <h1>{page.title}</h1>
          <p role="status">Loading account context…</p>
        </main>
      </PublicShell>
    );
  const principal = user?.id ?? "guest";
  return (
    <ReviewWorkspaceBody key={`${principal}:${page.slug}`} page={page} principal={principal} />
  );
}

export function ReviewWorkspaceBody({ page, principal }: { page: ReviewPage; principal: string }) {
  const draftKey = `${principal}:${page.slug}`;
  const [draft, setDraft] = useState<Draft>(() => inMemoryDrafts.get(draftKey) ?? empty(page));
  const [preview, setPreview] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [status, setStatus] = useState("");
  const [reset, setReset] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const previewPanelRef = useRef<HTMLDetailsElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reset) {
      resetCancelRef.current?.focus({ preventScroll: true });
      resetCancelRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [reset]);
  useEffect(() => {
    if (preview && previewExpanded) {
      previewPanelRef.current?.focus({ preventScroll: true });
      previewPanelRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [preview, previewExpanded]);
  const [call, setCall] = useState<"idle" | "preview" | "paused">("idle");
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  useEffect(() => {
    setDraft(inMemoryDrafts.get(draftKey) ?? empty(page));
    setPreview(false);
    setStatus("");
    setCall("idle");
    setReset(false);
    setReference(null);
  }, [draftKey, page]);
  useEffect(
    () => () => {
      if (reference) URL.revokeObjectURL(reference.url);
    },
    [reference],
  );
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      inMemoryDrafts.set(draftKey, next);
      return next;
    });
    setStatus(
      "Local draft retained during navigation. Save to keep it in this browser tab after refresh.",
    );
  };
  const content = JSON.stringify(
    { reviewOnly: true, serviceConnected: false, page: page.title, ...draft },
    null,
    2,
  );
  const save = () => {
    try {
      sessionStorage.setItem(`kova-review:${draftKey}`, JSON.stringify(draft));
      setStatus("Draft saved in this browser tab only. Nothing submitted.");
    } catch {
      setStatus(
        "Browser storage is unavailable. Your draft remains here; copy or download it before leaving.",
      );
    }
  };
  const restore = () => {
    try {
      const value = sessionStorage.getItem(`kova-review:${draftKey}`);
      if (!value) {
        setStatus("No saved draft for this page.");
        return;
      }
      const parsed = JSON.parse(value);
      if (typeof parsed.notes !== "string" || !Array.isArray(parsed.checked))
        throw new Error("Invalid draft");
      const restored = empty(page);
      for (const key of [
        "title",
        "notes",
        "audience",
        "mode",
        "ratio",
        "language",
        "speed",
        "referenceRole",
        "quality",
        "retentionDays",
        "retentionScope",
        "memberLabel",
        "role",
        "sharingPolicy",
        "adjustment",
        "apiInput",
        "apiOutput",
        "apiValidation",
      ] as const) {
        if (typeof parsed[key] === "string") restored[key] = parsed[key];
      }
      restored.checked = parsed.checked.filter(
        (value: unknown): value is string =>
          typeof value === "string" && page.checks.includes(value),
      );
      restored.audio = parsed.audio === true;
      inMemoryDrafts.set(draftKey, restored);
      setDraft(restored);
      setStatus("Local draft restored.");
    } catch {
      setStatus("This local draft could not load. Your current edits are preserved.");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Review draft copied. No public link was created.");
    } catch {
      setStatus("Copy failed. Select and copy the preview text, or download the draft.");
    }
  };
  const download = () => {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kova-${page.slug}-review.json`;
      anchor.click();
      setStatus(
        "Browser download requested for the local draft. This is not a contract, invoice or generated output.",
      );
    } catch {
      setStatus(
        "Download could not start. Your draft is unchanged; copy the preview text instead.",
      );
    } finally {
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      }
    }
  };
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="spec400-review">
        <nav aria-label="Breadcrumb">
          <Link to={"/review" as never}>Review pages</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{page.title}</span>
        </nav>
        <div className="spec400-review-heading">
          <div>
            <p className="spec400-eyebrow">{page.family} preview</p>
            <h1>{page.title}</h1>
          </div>
        </div>
        <p className="spec400-review-boundary">
          Local review only. No service is connected; nothing is sent or activated.
        </p>
        {ReviewFamilySurface({
          page,
          draft,
          update,
          reference,
          referenceInputRef,
          setReference,
          setStatus,
          call,
          setCall,
        })}
        <details className="spec400-review-card spec400-review-secondary">
          <summary>
            {page.family === "legal" ? "Questions and review notes" : "Review notes and tools"}
          </summary>
          {["legal", "team", "infrastructure", "media"].includes(page.family) && (
            <label>
              {page.family === "legal"
                ? "Questions for document review"
                : "Additional review notes"}
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(event) => update("notes", event.target.value)}
                placeholder="Use example information only."
              />
            </label>
          )}
          <div className="spec400-review-actions">
            <button onClick={save}>Save local draft</button>
            <button onClick={restore}>Restore saved draft</button>
            <button ref={resetTriggerRef} onClick={() => setReset(true)}>
              Reset draft
            </button>
            <button
              ref={previewTriggerRef}
              onClick={() => {
                setPreviewExpanded(true);
                setPreview(true);
              }}
            >
              Preview draft
            </button>
          </div>
          <p>
            Drafts remain account-scoped in this session. Save retains a draft in this browser tab
            after refresh. Export produces review data only.
          </p>
        </details>
        <details className="spec400-review-card spec400-review-secondary">
          <summary>Readiness and service details</summary>
          <p>{page.summary}</p>
          <p>These checks record your review; they do not verify or enable a service.</p>
          {page.checks.map((check) => (
            <label className="spec400-check" key={check}>
              <input
                type="checkbox"
                checked={draft.checked.includes(check)}
                onChange={(event) =>
                  update(
                    "checked",
                    event.target.checked
                      ? [...draft.checked, check]
                      : draft.checked.filter((value) => value !== check),
                  )
                }
              />
              <span>{check}</span>
            </label>
          ))}
        </details>
        {reset && (
          <section
            role="group"
            aria-labelledby="review-reset-title"
            className="spec400-review-card"
          >
            <h2 id="review-reset-title">Reset this draft?</h2>
            <p>This clears current unsaved fields. A saved browser-tab draft is unchanged.</p>
            <div className="spec400-review-actions">
              <button
                ref={resetCancelRef}
                onClick={() => {
                  setReset(false);
                  resetTriggerRef.current?.focus();
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  inMemoryDrafts.delete(draftKey);
                  setDraft(empty(page));
                  setPreview(false);
                  setCall("idle");
                  setReference(null);
                  if (referenceInputRef.current) referenceInputRef.current.value = "";
                  setReset(false);
                  setStatus("Current draft reset. Saved draft unchanged.");
                  resetTriggerRef.current?.focus();
                }}
              >
                Reset current draft
              </button>
            </div>
          </section>
        )}
        {preview && (
          <details
            ref={previewPanelRef}
            tabIndex={-1}
            open={previewExpanded}
            onToggle={(event) => setPreviewExpanded(event.currentTarget.open)}
            className="spec400-review-card spec400-review-secondary"
          >
            <summary>Export preview</summary>
            <h2>Exact local draft preview</h2>
            <p>This content is not submitted or publicly shared.</p>
            <pre tabIndex={0}>{content}</pre>
            <div className="spec400-review-actions">
              <button onClick={copy}>Copy draft</button>
              <button onClick={download}>Download draft JSON</button>
              <button
                onClick={() => {
                  setPreview(false);
                  previewTriggerRef.current?.focus();
                }}
              >
                Close preview
              </button>
            </div>
          </details>
        )}
        <p role="status" aria-live="polite">
          {status}
        </p>
      </main>
    </PublicShell>
  );
}
