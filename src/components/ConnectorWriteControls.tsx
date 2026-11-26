import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SlidersHorizontal } from "lucide-react";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth-fetch";
import {
  createLinearIssue,
  createOneDriveFolder,
  createGoogleDriveFolder,
  createOutlookEvent,
  createOutlookDraft,
  getConnectorWriteAccess,
  loadTanaProposalSchema,
  runConnectorWriteAction,
  sendOutlookMessage,
  setConnectorWriteAccess,
} from "@/lib/connector-write.functions";
import type { WritableConnector } from "@/lib/connector-write-policy.server";
import {
  EXTRA_WRITE_ACTIONS,
  isExtraWriteConnector,
  type ExtraWriteConnector,
  type WriteFields,
} from "@/lib/connector-write-actions";

type Props = {
  connector: Exclude<WritableConnector, "plaid">;
  target: string;
  label: string;
  providerCanWrite: boolean;
  authorizeWrite?: () => void;
  canSendOutlook?: boolean;
  authorizeOutlookSend?: () => void;
};

export function ConnectorWriteControls(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Permissions for ${props.label}`}
      >
        <SlidersHorizontal aria-hidden="true" />
        Permissions
      </Button>
      <DialogContent className="spec400-plugin-detail" closeLabel="Close permissions">
        <DialogHeader>
          <DialogTitle>Permissions</DialogTitle>
          <DialogDescription>{props.label}</DialogDescription>
        </DialogHeader>
        {open && <PermissionEditor key={`${props.connector}:${props.target}`} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PermissionEditor({
  connector,
  target,
  providerCanWrite,
  authorizeWrite,
  canSendOutlook,
  authorizeOutlookSend,
  label,
}: Props) {
  const owner = useUser().user?.id;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{
    name: string;
    body: string;
    recipient: string;
    teamId: string;
    start: string;
    end: string;
    actionId: string;
  } | null>(null);
  const load = useServerFn(getConnectorWriteAccess);
  const save = useServerFn(setConnectorWriteAccess);
  const folder = useServerFn(createOneDriveFolder);
  const googleFolder = useServerFn(createGoogleDriveFolder);
  const outlookEvent = useServerFn(createOutlookEvent);
  const outlookDraft = useServerFn(createOutlookDraft);
  const outlookSend = useServerFn(sendOutlookMessage);
  const linearIssue = useServerFn(createLinearIssue);
  const canWrite = providerCanWrite && enabled === true;
  const extraWrite = isExtraWriteConnector(connector) ? connector : null;
  const kind =
    connector === "onedrive" || connector === "google-drive"
      ? "folder"
      : connector === "outlook"
        ? "draft"
        : connector === "outlook-calendar"
          ? "event"
          : "issue";
  const labelForWrite = kind === "draft" ? "Save Outlook draft" : `Create ${kind}`;
  useEffect(() => {
    if (!owner) return;
    let current = true;
    load({ data: { connector, target }, headers: { "X-Kova-Owner": owner } })
      .then((result) => {
        if (current) setEnabled(result.enabled);
      })
      .catch(() => {
        if (current)
          setNotice("Permission status could not be loaded. Reopen this panel to retry.");
      });
    return () => {
      current = false;
    };
  }, [connector, target, owner, load]);

  const switchAccess = async (next: boolean) => {
    if (!owner) return;
    setBusy(true);
    setNotice("");
    setDraft(null);
    try {
      const result = await save({
        data: { subject: { connector, target }, enabled: next },
        headers: { "X-Kova-Owner": owner },
      });
      if ("error" in result && result.error) setNotice(result.error);
      else setEnabled(result.enabled === true);
    } catch {
      setNotice("The permission change could not be confirmed. Reopen this panel to check.");
      setEnabled(null);
    } finally {
      setBusy(false);
    }
  };

  const performWrite = async (send = false) => {
    if (!draft || !canWrite || busy || !owner || (send && !canSendOutlook)) return;
    setBusy(true);
    setNotice("");
    try {
      if (kind === "folder") {
        const createFolder = connector === "onedrive" ? folder : googleFolder;
        const result = await createFolder({
          data: { target, name: draft.name },
          headers: { "X-Kova-Owner": owner },
        });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice(
          connector === "onedrive"
            ? "Folder created in OneDrive."
            : "Folder created in Google Drive.",
        );
      } else if (connector === "outlook-calendar") {
        const result = await outlookEvent({
          data: {
            target,
            title: draft.name,
            start: draft.start,
            end: draft.end,
            actionId: draft.actionId,
          },
          headers: { "X-Kova-Owner": owner },
        });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice("Event created in Outlook Calendar.");
      } else if (connector === "outlook") {
        const data = { target, recipient: draft.recipient, subject: draft.name, body: draft.body };
        const headers = { "X-Kova-Owner": owner };
        const result = send
          ? await outlookSend({ data: { ...data, confirmed: true }, headers })
          : await outlookDraft({ data, headers });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice(send ? "Outlook accepted the message for sending." : "Draft saved to Outlook.");
      } else if (connector === "linear") {
        const result = await linearIssue({
          data: {
            target,
            teamId: draft.teamId,
            title: draft.name,
            description: draft.body,
            confirmed: true,
          },
          headers: { "X-Kova-Owner": owner },
        });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice("Issue created in Linear.");
      } else {
        const result = await authFetch("/api/github/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
          body: JSON.stringify({
            repository: label,
            expectedRepositoryId: target,
            tool: "createIssue",
            confirmed: true,
            args: { title: draft.name, body: draft.body },
          }),
        });
        if (!result.ok) {
          setNotice("Issue creation could not be confirmed. Check the repository before retrying.");
          return;
        }
        setNotice("Issue created on GitHub.");
      }
    } catch {
      setNotice("The write could not be confirmed. Check the provider before retrying.");
    } finally {
      setDraft(null);
      setBusy(false);
    }
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const start = kind === "event" ? `${form.get("start")}:00Z` : "";
    const end = kind === "event" ? `${form.get("end")}:00Z` : "";
    if (kind === "event" && !(Date.parse(end) > Date.parse(start))) {
      setNotice("End time must follow start time.");
      return;
    }
    if (name)
      setDraft({
        name,
        body: String(form.get("body") ?? ""),
        recipient: String(form.get("recipient") ?? "").trim(),
        teamId: String(form.get("teamId") ?? "").trim(),
        start,
        end,
        actionId: crypto.randomUUID(),
      });
  };

  return (
    <section className="spec400-plugin-detail-section">
      <div className="kova-directory-access" role="group" aria-label="KovaGPT access level">
        <Button
          type="button"
          variant={enabled === false ? "default" : "outline"}
          disabled={busy || enabled === null}
          aria-pressed={enabled === false}
          onClick={() => void switchAccess(false)}
        >
          Read only
        </Button>
        <Button
          type="button"
          variant={canWrite ? "default" : "outline"}
          aria-pressed={canWrite}
          disabled={busy || enabled === null || (!providerCanWrite && !authorizeWrite)}
          onClick={() => (providerCanWrite ? void switchAccess(true) : authorizeWrite?.())}
        >
          Read and write
        </Button>
      </div>
      <p>
        Write access in KovaGPT applies to this account or repository. Each supported write requires
        your approval.
      </p>
      {!providerCanWrite && (
        <p>
          {authorizeWrite
            ? "Authorize write access at the provider, then return here to enable it in KovaGPT."
            : "Write access requires permission from the provider."}
        </p>
      )}
      {canWrite && owner && extraWrite && (
        <ExtraWriteForm connector={extraWrite} target={target} owner={owner} />
      )}
      {canWrite && authorizeOutlookSend && !canSendOutlook && (
        <Button type="button" variant="outline" disabled={busy} onClick={authorizeOutlookSend}>
          Authorize sending with Outlook
        </Button>
      )}
      {canWrite &&
        !extraWrite &&
        connector !== "gmail" &&
        connector !== "google-calendar" &&
        (draft ? (
          <div className="kova-directory-panel">
            <h3>Review {kind}</h3>
            {draft.recipient && <p className="break-words">To {draft.recipient}</p>}
            {draft.teamId && <p className="break-words">Linear team {draft.teamId}</p>}
            <p className="break-words">{draft.name}</p>
            {kind === "event" && (
              <p>
                {draft.start.slice(0, 16).replace("T", " ")} to{" "}
                {draft.end.slice(0, 16).replace("T", " ")} UTC
              </p>
            )}
            {draft.body && <p className="whitespace-pre-wrap break-words">{draft.body}</p>}
            <div className="spec400-plugin-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void performWrite()}>
                {labelForWrite}
              </Button>
              {connector === "outlook" && canSendOutlook && (
                <Button type="button" disabled={busy} onClick={() => void performWrite(true)}>
                  Send Outlook message
                </Button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={review} className="kova-directory-panel">
            {connector === "linear" && (
              <label className="grid gap-2">
                Linear team UUID
                <Input
                  name="teamId"
                  pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"
                  maxLength={36}
                  required
                />
                <span>In Linear, use Copy model UUID on the team you want to use.</span>
              </label>
            )}
            {kind === "draft" && (
              <label className="grid gap-2">
                Recipient
                <Input name="recipient" type="email" maxLength={254} required />
              </label>
            )}
            <label className="grid gap-2">
              {kind === "folder"
                ? connector === "onedrive"
                  ? "Folder name in My files"
                  : "Folder name in My Drive"
                : kind === "draft"
                  ? "Subject"
                  : kind === "event"
                    ? "Event title"
                    : "Issue title"}
              <Input name="name" maxLength={120} required />
            </label>
            {kind === "event" && (
              <>
                <label className="grid gap-2">
                  Start (UTC)
                  <Input name="start" type="datetime-local" required />
                </label>
                <label className="grid gap-2">
                  End (UTC)
                  <Input name="end" type="datetime-local" required />
                </label>
              </>
            )}
            {(kind === "draft" || kind === "issue") && (
              <label className="grid gap-2">
                {kind === "draft" ? "Message" : "Issue description"}
                <Textarea name="body" maxLength={4000} />
              </label>
            )}
            <Button type="submit">{`Review ${kind}`}</Button>
          </form>
        ))}
      {notice && (
        <p role="status" className="break-words">
          {notice}
        </p>
      )}
    </section>
  );
}

function ExtraWriteForm({
  connector,
  target,
  owner,
}: {
  connector: ExtraWriteConnector;
  target: string;
  owner: string;
}) {
  const definition = EXTRA_WRITE_ACTIONS[connector];
  const perform = useServerFn(runConnectorWriteAction);
  const loadTanaSchema = useServerFn(loadTanaProposalSchema);
  const [review, setReview] = useState<WriteFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    message: string;
    link?: string;
    reference?: string;
  } | null>(null);
  const [requestId, setRequestId] = useState(() =>
    connector === "hyperframes-heygen" ? crypto.randomUUID() : "",
  );
  const [tanaSchema, setTanaSchema] = useState<string | null>(null);

  async function showTanaFields() {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await loadTanaSchema({
        data: { target },
        headers: { "X-Kova-Owner": owner },
      });
      if (result.schema) setTanaSchema(result.schema);
      else setOutcome({ message: result.error ?? "Could not load Tana's request fields." });
    } catch {
      setOutcome({ message: "Could not load Tana's request fields." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const response = await perform({
        data: { connector, target, fields: review, confirmed: true },
        headers: { "X-Kova-Owner": owner },
      });
      setOutcome(
        "ok" in response && response.ok
          ? {
              message:
                connector === "hyperframes-heygen"
                  ? "HeyGen queued the render."
                  : connector === "gamma"
                    ? "Gamma queued the presentation."
                    : connector === "tana"
                      ? "Tana created a proposal for review."
                      : "The provider confirmed the change.",
              link: "link" in response ? response.link : undefined,
              reference: "reference" in response ? response.reference : undefined,
            }
          : { message: response.error ?? "The provider did not confirm the change." },
      );
      if ("ok" in response && response.ok && connector === "hyperframes-heygen")
        setRequestId(crypto.randomUUID());
    } catch {
      setOutcome({
        message: "The change could not be confirmed. Check the provider before retrying.",
      });
    } finally {
      setBusy(false);
      setReview(null);
    }
  }

  return (
    <div className="kova-directory-panel">
      <h3>{review ? `Review: ${definition.action}` : definition.action}</h3>
      <p>{definition.summary}</p>
      {connector === "tana" && !review && (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void showTanaFields()}
          >
            Load request fields from Tana
          </Button>
          {tanaSchema && (
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words"
              aria-label="Tana request schema"
            >
              {tanaSchema}
            </pre>
          )}
        </>
      )}
      {review ? (
        <>
          <dl>
            {definition.fields.map(({ name, label }) => (
              <div key={name}>
                <dt>{label}</dt>
                <dd className="whitespace-pre-wrap break-words">{review[name]}</dd>
              </div>
            ))}
          </dl>
          <div className="spec400-plugin-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {definition.action}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const fields = Object.fromEntries(
              definition.fields.map(({ name }) => [name, String(data.get(name) ?? "").trim()]),
            );
            if (Object.values(fields).some((value) => !value)) return;
            setOutcome(null);
            setReview(fields);
          }}
        >
          {definition.fields.map(({ name, label, maxLength, multiline }) => {
            const Field = multiline ? Textarea : Input;
            return (
              <label key={name} className="grid gap-2">
                {label}
                <Field
                  name={name}
                  maxLength={maxLength}
                  required
                  defaultValue={name === "requestId" ? requestId : undefined}
                  onChange={
                    name === "requestId"
                      ? (event) => setRequestId(event.currentTarget.value)
                      : undefined
                  }
                />
              </label>
            );
          })}
          <Button type="submit">Review action</Button>
        </form>
      )}
      {outcome && (
        <p role="status">
          {outcome.message}
          {outcome.reference && (
            <>
              {" "}
              {connector === "gamma"
                ? "Generation ID"
                : connector === "tana"
                  ? "Proposal session"
                  : "Render ID"}{" "}
              {outcome.reference}
            </>
          )}
          {outcome.link && (
            <>
              {" "}
              <a className="underline" href={outcome.link} target="_blank" rel="noreferrer">
                Open scheduling link
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
