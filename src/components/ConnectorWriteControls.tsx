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
  createOneDriveFolder,
  createOutlookDraft,
  getConnectorWriteAccess,
  setConnectorWriteAccess,
} from "@/lib/connector-write.functions";
import type { WritableConnector } from "@/lib/connector-write-policy.server";

type Props = {
  connector: WritableConnector;
  target: string;
  label: string;
  providerCanWrite: boolean;
  authorizeWrite?: () => void;
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

function PermissionEditor({ connector, target, providerCanWrite, authorizeWrite, label }: Props) {
  const owner = useUser().user?.id;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{ name: string; body: string; recipient: string } | null>(
    null,
  );
  const load = useServerFn(getConnectorWriteAccess);
  const save = useServerFn(setConnectorWriteAccess);
  const folder = useServerFn(createOneDriveFolder);
  const outlookDraft = useServerFn(createOutlookDraft);
  const canWrite = providerCanWrite && enabled === true;
  const kind = connector === "onedrive" ? "folder" : connector === "outlook" ? "draft" : "issue";
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

  const performWrite = async () => {
    if (!draft || !canWrite || busy || !owner) return;
    setBusy(true);
    setNotice("");
    try {
      if (connector === "onedrive") {
        const result = await folder({
          data: { target, name: draft.name },
          headers: { "X-Kova-Owner": owner },
        });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice("Folder created in OneDrive.");
      } else if (connector === "outlook") {
        const result = await outlookDraft({
          data: { target, recipient: draft.recipient, subject: draft.name, body: draft.body },
          headers: { "X-Kova-Owner": owner },
        });
        if ("error" in result && result.error) {
          setNotice(result.error);
          return;
        }
        setNotice("Draft saved to Outlook.");
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
    if (name)
      setDraft({
        name,
        body: String(form.get("body") ?? ""),
        recipient: String(form.get("recipient") ?? "").trim(),
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
      {canWrite &&
        (connector === "onedrive" || connector === "github" || connector === "outlook") &&
        (draft ? (
          <div className="kova-directory-panel">
            <h3>Review {kind}</h3>
            {draft.recipient && <p className="break-words">To {draft.recipient}</p>}
            <p className="break-words">{draft.name}</p>
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
            </div>
          </div>
        ) : (
          <form onSubmit={review} className="kova-directory-panel">
            {kind === "draft" && (
              <label className="grid gap-2">
                Recipient
                <Input name="recipient" type="email" maxLength={254} required />
              </label>
            )}
            <label className="grid gap-2">
              {kind === "folder"
                ? "Folder name in My files"
                : kind === "draft"
                  ? "Subject"
                  : "Issue title"}
              <Input name="name" maxLength={120} required />
            </label>
            {kind !== "folder" && (
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
