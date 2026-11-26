import { ArrowLeft, ArrowUpRight, BookOpen, Code2, Plug, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  checkConnectorSource,
  listConnectorSubmissions,
  listPublishedConnectorSubmissions,
  reviewConnectorSubmission,
  saveConnectorSubmission,
  submitConnectorForReview,
  type ConnectorSubmission,
  type ConnectorSubmissionDetails,
} from "@/lib/connector-submissions.functions";

const statuses = {
  draft: "Draft",
  submitted: "In review",
  approved: "Published",
  changes_requested: "Changes requested",
};
const base = "/apps?directory=submissions";
const categories: ConnectorSubmissionDetails["category"][] = [
  "Workflows",
  "Developer tools",
  "Productivity",
  "Files and notes",
  "Communication",
];
type Collection = Awaited<ReturnType<typeof listConnectorSubmissions>>;

function DirectoryLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Button asChild variant={primary ? "default" : "outline"}>
      <a href={href}>{children}</a>
    </Button>
  );
}

export function ConnectorDirectoryBuilder() {
  return (
    <section className="kova-directory-build" aria-label="Build for KovaGPT">
      <div className="kova-directory-build-icon">
        <Plug aria-hidden="true" />
      </div>
      <div>
        <h2>Build for KovaGPT</h2>
        <p>Submit a plugin bundle or a remote connector for directory review.</p>
      </div>
      <div className="spec400-plugin-actions">
        <DirectoryLink href="/apps?directory=guide">
          <BookOpen aria-hidden="true" /> Developer guide
        </DirectoryLink>
        <DirectoryLink href={base} primary>
          Submissions <ArrowUpRight aria-hidden="true" />
        </DirectoryLink>
      </div>
    </section>
  );
}

export function PublishedConnectorListings() {
  const load = useServerFn(listPublishedConnectorSubmissions);
  const [listings, setListings] = useState<
    Awaited<ReturnType<typeof listPublishedConnectorSubmissions>>
  >([]);
  useEffect(() => {
    let live = true;
    void load()
      .then((result) => {
        if (live) setListings(result);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [load]);
  if (!listings.length) return null;
  return (
    <section className="space-y-3" aria-labelledby="community-listing-title">
      <h2 id="community-listing-title">Community listings</h2>
      <ul className="kova-directory-rows">
        {listings.map((listing) => (
          <li className="kova-directory-panel" key={listing.id}>
            <h3>{listing.name}</h3>
            <p>{listing.description}</p>
            <small>{listing.category}</small>
            <div className="spec400-plugin-actions">
              <DirectoryLink href={listing.repository ?? "/apps?plugin=custom-mcp"}>
                {listing.repository ? "View repository" : "Manage MCP connections"}
              </DirectoryLink>
              {listing.documentation && (
                <DirectoryLink href={listing.documentation}>Documentation</DirectoryLink>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConnectorDirectorySubmissions({
  owner,
  guide,
}: {
  owner: string | null;
  guide: boolean;
}) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selected, setSelected] = useState<ConnectorSubmission | null>(null);
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const load = useServerFn(listConnectorSubmissions);
  useEffect(() => {
    if (!owner || guide) return;
    let live = true;
    setError("");
    void load({ headers: { "X-Kova-Owner": owner } })
      .then((result) => {
        if (live) setCollection(result);
      })
      .catch(() => {
        if (live) setError("Submissions could not be loaded. Try again.");
      });
    return () => {
      live = false;
    };
  }, [owner, guide, load, reload]);

  function exitEditor() {
    setSelected(null);
    setEditing(false);
    setChoosing(false);
    setReload((value) => value + 1);
  }

  if (guide)
    return (
      <div className="kova-directory-workspace">
        <DirectoryLink href={base}>
          <ArrowLeft aria-hidden="true" /> Submissions
        </DirectoryLink>
        <h1>Build for KovaGPT</h1>
        <section className="kova-directory-panel">
          <h2>Plugin bundles</h2>
          <p>
            Place a kova-plugin.json file at the root of a public GitHub repository. Its name and
            description are checked before review.
          </p>
          <pre className="overflow-auto rounded-xl border p-3">
            {JSON.stringify(
              { name: "My plugin", description: "What this plugin helps users do" },
              null,
              2,
            )}
          </pre>
          <p>Approved bundles appear as directory listings that link to their source.</p>
        </section>
        <section className="kova-directory-panel">
          <h2>Remote MCP connectors</h2>
          <p>
            Submit a public HTTPS endpoint and explain its authentication, tool access, and data
            handling. A reviewer must approve the read tool before it can appear in the directory.
          </p>
          <DirectoryLink href="/apps?plugin=custom-mcp">Open Custom MCP connections</DirectoryLink>
        </section>
        <section className="kova-directory-panel">
          <h2>Reviews and resubmissions</h2>
          <p>
            Use Submissions to track review status. If a change is requested, open the submission,
            read the reviewer’s note, then edit and submit again.
          </p>
          <DirectoryLink href={base}>View submissions</DirectoryLink>
        </section>
      </div>
    );

  if (editing && selected && owner)
    return (
      <SubmissionEditor key={selected.id} owner={owner} initial={selected} onExit={exitEditor} />
    );
  if (choosing)
    return (
      <div className="kova-directory-workspace">
        <Button variant="ghost" onClick={() => setChoosing(false)}>
          <ArrowLeft aria-hidden="true" /> Submissions
        </Button>
        <h1>Choose a submission type</h1>
        <div className="kova-directory-choice-grid">
          {(
            [
              [
                "bundle",
                Code2,
                "Plugin bundle",
                "List a bundle hosted in a public GitHub repository.",
              ],
              [
                "mcp",
                Plug,
                "Remote MCP connector",
                "Submit a hosted server and describe the tools it offers.",
              ],
            ] as const
          ).map(([kind, Icon, title, description]) => (
            <button
              type="button"
              key={kind}
              className="kova-directory-choice"
              onClick={() => {
                setSelected({
                  id: crypto.randomUUID(),
                  revision: -1,
                  status: "draft",
                  review_note: null,
                  updated_at: "",
                  details: {
                    kind,
                    source: "",
                    name: "",
                    description: "",
                    documentation: "",
                    category: "Productivity",
                    dataHandling: "",
                    contact: "",
                    attested: false,
                  },
                });
                setEditing(true);
                setChoosing(false);
              }}
            >
              <Icon aria-hidden="true" />
              <strong>{title}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="kova-directory-workspace">
      <DirectoryLink href="/apps">
        <ArrowLeft aria-hidden="true" /> Connections
      </DirectoryLink>
      <header className="kova-directory-section-head">
        <div>
          <h1>Submissions</h1>
          <p>Manage drafts and track directory review.</p>
        </div>
        <div className="spec400-plugin-actions">
          <DirectoryLink href="/apps?directory=guide">Developer guide</DirectoryLink>
          {owner && (
            <Button onClick={() => setChoosing(true)}>
              <Plus aria-hidden="true" /> New submission
            </Button>
          )}
        </div>
      </header>
      {!owner ? (
        <section className="kova-directory-panel">
          <p>Sign in to submit a plugin to KovaGPT.</p>
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
        </section>
      ) : error ? (
        <section className="kova-directory-panel">
          <p role="alert">{error}</p>
          <Button onClick={() => setReload((value) => value + 1)}>Try again</Button>
        </section>
      ) : !collection ? (
        <p role="status">Loading submissions…</p>
      ) : collection.own.length ? (
        <ul className="kova-directory-submission-list">
          {collection.own.map((item) => (
            <li className="kova-directory-panel kova-directory-section-head" key={item.id}>
              <div>
                <h2>{item.details.name || "Untitled submission"}</h2>
                <p>
                  {statuses[item.status]} ·{" "}
                  {item.details.kind === "mcp" ? "Remote MCP connector" : "Plugin bundle"}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(item);
                  setEditing(true);
                }}
              >
                Open submission
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <section className="kova-directory-empty">
          <Plug aria-hidden="true" />
          <h2>No submissions yet</h2>
          <p>Your drafts and submitted listings will appear here.</p>
        </section>
      )}
      {owner && collection?.reviewer && (
        <section className="kova-directory-panel">
          <h2>Review queue</h2>
          {collection.queue.length ? (
            collection.queue.map((item) => (
              <ReviewConnector key={item.id} owner={owner} item={item} onSaved={exitEditor} />
            ))
          ) : (
            <p>No submissions waiting for review.</p>
          )}
        </section>
      )}
    </div>
  );
}

function SubmissionEditor({
  initial,
  owner,
  onExit,
}: {
  initial: ConnectorSubmission;
  owner: string;
  onExit: () => void;
}) {
  const [record, setRecord] = useState(initial);
  const [details, setDetails] = useState(initial.details);
  const [step, setStep] = useState(0);
  const [sourceCheck, setSourceCheck] = useState("");
  const [sourceDialog, setSourceDialog] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useServerFn(saveConnectorSubmission);
  const validate = useServerFn(checkConnectorSource);
  const send = useServerFn(submitConnectorForReview);
  const editable = record.status === "draft" || record.status === "changes_requested";
  const steps = [
    "Source",
    "Content",
    "Listing",
    ...(details.kind === "mcp" ? ["Test connection"] : []),
    "Data handling",
    "Compliance",
    "Review",
  ];
  const current = steps[step];
  const update = <K extends keyof ConnectorSubmissionDetails>(
    key: K,
    value: ConnectorSubmissionDetails[K],
  ) => {
    setDetails((old) => ({ ...old, [key]: value }));
    if (key === "source") setSourceCheck("");
    setNotice("");
  };
  const persist = async () => {
    const updated = await save({
      data: { id: record.id, revision: record.revision, details },
      headers: { "X-Kova-Owner": owner },
    });
    setRecord(updated);
    return updated;
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This change could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    const result = await validate({
      data: { kind: details.kind, source: details.source },
      headers: { "X-Kova-Owner": owner },
    });
    setSourceCheck(result.label);
  };
  const advance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || busy) return;
    void run(async () => {
      if (current === "Source" && !sourceCheck) await check();
      const saved = await persist();
      if (current === "Review") {
        await send({
          data: { id: saved.id, revision: saved.revision },
          headers: { "X-Kova-Owner": owner },
        });
        onExit();
      } else setStep((index) => index + 1);
    });
  };
  const field = (
    label: string,
    key: "name" | "source" | "documentation" | "contact",
    max: number,
    required = false,
    type = "text",
  ) => (
    <label className="kova-directory-field" key={key}>
      {label}
      <Input
        value={details[key]}
        maxLength={max}
        required={required}
        type={type}
        readOnly={!editable}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  return (
    <div className="kova-directory-workspace">
      <header className="kova-directory-section-head">
        <div>
          <h1>{editable ? "Submit to KovaGPT" : details.name || "Submission"}</h1>
          <p>{statuses[record.status]}</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={onExit}>
          <ArrowLeft aria-hidden="true" /> Submissions
        </Button>
      </header>
      {record.review_note && (
        <div className="kova-directory-panel">
          <h2>Reviewer note</h2>
          <p>{record.review_note}</p>
        </div>
      )}
      <div className="kova-directory-wizard">
        <nav aria-label="Submission steps">
          <ol>
            {steps.map((title, index) => (
              <li key={title}>
                <Button
                  variant={index === step ? "secondary" : "ghost"}
                  aria-current={index === step ? "step" : undefined}
                  disabled={busy}
                  onClick={() => {
                    setStep(index);
                    setNotice("");
                  }}
                >
                  {title}
                </Button>
              </li>
            ))}
          </ol>
        </nav>
        <form className="kova-directory-panel" onSubmit={advance}>
          <h2>{current}</h2>
          {current === "Source" && (
            <>
              {details.kind === "bundle" ? (
                field("GitHub repository", "source", 1500, true)
              ) : (
                <>
                  <p>{details.source || "Add the HTTPS URL for your remote MCP server."}</p>
                  {editable && (
                    <Button type="button" variant="outline" onClick={() => setSourceDialog(true)}>
                      {details.source ? "Edit MCP server" : "Add MCP server"}
                    </Button>
                  )}
                </>
              )}
              {editable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !details.source}
                  onClick={() => void run(check)}
                >
                  Validate source
                </Button>
              )}
            </>
          )}
          {current === "Content" && (
            <>
              {field("Plugin name", "name", 80, true)}
              <label className="kova-directory-field">
                Description
                <Textarea
                  value={details.description}
                  maxLength={320}
                  required
                  readOnly={!editable}
                  onChange={(event) => update("description", event.target.value)}
                />
              </label>
            </>
          )}
          {current === "Listing" && (
            <>
              <label className="kova-directory-field">
                Category
                <select
                  value={details.category}
                  disabled={!editable}
                  onChange={(event) =>
                    update("category", event.target.value as ConnectorSubmissionDetails["category"])
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              {field("Documentation URL (optional)", "documentation", 1500, false, "url")}
            </>
          )}
          {current === "Test connection" && (
            <>
              <p>Check whether the deployment has a reviewed read tool for this endpoint.</p>
              {editable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !details.source}
                  onClick={() => void run(check)}
                >
                  Check server registration
                </Button>
              )}
            </>
          )}
          {current === "Data handling" && (
            <label className="kova-directory-field">
              Describe the data collected, how it is used, and how long it is retained
              <textarea
                className="kova-directory-textarea"
                value={details.dataHandling}
                maxLength={3600}
                required
                readOnly={!editable}
                onChange={(event) => update("dataHandling", event.target.value)}
              />
            </label>
          )}
          {current === "Compliance" && (
            <>
              {field("Contact email", "contact", 254, true, "email")}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={details.attested}
                  disabled={!editable}
                  onChange={(event) => update("attested", event.target.checked)}
                />{" "}
                I’m authorized to submit this source and have accurately described its access and
                data handling.
              </label>
            </>
          )}
          {current === "Review" && (
            <>
              <dl className="kova-directory-summary">
                {[
                  ["Source", details.source],
                  ["Name", details.name],
                  ["Description", details.description],
                  ["Category", details.category],
                  ["Documentation", details.documentation],
                  ["Data handling", details.dataHandling],
                  ["Contact", details.contact],
                  ["Attestation", details.attested ? "Confirmed" : ""],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <p>Approved submissions are published to the KovaGPT directory.</p>
            </>
          )}
          {sourceCheck && (current === "Source" || current === "Test connection") && (
            <p role="status">{sourceCheck}</p>
          )}
          {notice && <p role="alert">{notice}</p>}
          <div className="spec400-plugin-actions">
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep(step - 1);
                  setNotice("");
                }}
              >
                Back
              </Button>
            )}
            {editable && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await persist();
                    onExit();
                  })
                }
              >
                Save and exit
              </Button>
            )}
            {editable && (
              <Button type="submit" disabled={busy}>
                {current === "Review" ? "Submit for review" : "Continue"}
              </Button>
            )}
          </div>
        </form>
      </div>
      <Dialog open={sourceDialog} onOpenChange={setSourceDialog}>
        <DialogContent className="spec400-plugin-detail" closeLabel="Close MCP server">
          <DialogHeader>
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Enter the public HTTPS endpoint KovaGPT should review.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const next = String(new FormData(event.currentTarget).get("url") ?? "").trim();
              if (!next.startsWith("https://")) {
                event.currentTarget
                  .querySelector("input")
                  ?.setCustomValidity("Enter an HTTPS URL.");
                event.currentTarget.reportValidity();
                return;
              }
              update("source", next);
              setSourceDialog(false);
            }}
          >
            <label className="kova-directory-field">
              MCP server URL
              <Input
                name="url"
                type="url"
                defaultValue={details.source}
                maxLength={1500}
                required
                onChange={(event) => event.currentTarget.setCustomValidity("")}
              />
            </label>
            <div className="spec400-plugin-actions">
              <Button type="button" variant="outline" onClick={() => setSourceDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">Save server</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewConnector({
  item,
  owner,
  onSaved,
}: {
  item: ConnectorSubmission;
  owner: string;
  onSaved: () => void;
}) {
  const review = useServerFn(reviewConnectorSubmission);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approved" | "changes_requested") => {
    setBusy(true);
    setError("");
    try {
      await review({
        data: { id: item.id, revision: item.revision, decision, note },
        headers: { "X-Kova-Owner": owner },
      });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Review could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="kova-directory-review">
      <summary>
        {item.details.name} ·{" "}
        {item.details.kind === "mcp" ? "Remote MCP connector" : "Plugin bundle"}
      </summary>
      <p className="break-all">{item.details.source}</p>
      <p>{item.details.description}</p>
      <p>{item.details.category}</p>
      {item.details.documentation && <p>{item.details.documentation}</p>}
      <p>{item.details.dataHandling}</p>
      <p>{item.details.contact}</p>
      <p>{item.details.attested ? "Submitter confirmed authorization" : "Attestation missing"}</p>
      <label className="kova-directory-field">
        Reviewer note
        <Textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="spec400-plugin-actions">
        <Button
          variant="outline"
          disabled={busy || !note.trim()}
          onClick={() => void decide("changes_requested")}
        >
          Request changes
        </Button>
        <Button disabled={busy} onClick={() => void decide("approved")}>
          Approve listing
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
