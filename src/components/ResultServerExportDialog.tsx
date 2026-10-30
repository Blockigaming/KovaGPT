import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  DOCUMENT_EXPORT_PATH,
  type DocumentDeliveryFormat,
} from "@/lib/document-export-policy.mjs";
import { prepareServerDocument } from "@/lib/writing-export/server-delivery";

type Props = {
  title: string;
  content: string;
  kind: string;
  onClose: () => void;
  isCurrent: () => boolean;
  onCloseAutoFocus: (event: Event) => void;
};
type Prepared = Awaited<ReturnType<typeof prepareServerDocument>> & {
  title: string;
  content: string;
};

export function ResultServerExportDialog({
  title,
  content,
  kind,
  onClose,
  isCurrent,
  onCloseAutoFocus,
}: Props) {
  const [format, setFormat] = useState<DocumentDeliveryFormat>(
    kind === "writing" ? "md" : kind === "website" ? "html" : "txt",
  );
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(false);
  const active = useRef(true);
  const sequence = useRef(0);
  const preparing = useRef(false);
  const submitted = useRef(false);
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ title, content, format, isCurrent });
  latest.current = { title, content, format, isCurrent };
  const formatId = useId();
  const ready =
    prepared?.title === title && prepared.content === content && prepared.format === format
      ? prepared
      : null;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      sequence.current += 1;
      clearTimeout(cleanupTimer.current);
    };
  }, []);
  useEffect(() => {
    sequence.current += 1;
    preparing.current = false;
    submitted.current = false;
    setPrepared(null);
    setPending(false);
    setError("");
    setRequested(false);
    clearTimeout(cleanupTimer.current);
  }, [title, content, format]);
  const current = () => active.current && latest.current.isCurrent();
  const prepare = async () => {
    if (!current() || preparing.current) return;
    const request = ++sequence.current;
    preparing.current = true;
    setPending(true);
    setPrepared(null);
    setError("");
    setRequested(false);
    const stillCurrent = () =>
      current() &&
      sequence.current === request &&
      latest.current.title === title &&
      latest.current.content === content &&
      latest.current.format === format;
    try {
      const file = await prepareServerDocument(format, title, content);
      if (stillCurrent()) {
        submitted.current = false;
        setPrepared({ ...file, title, content });
      }
    } catch (failure) {
      if (stillCurrent())
        setError(
          failure instanceof Error ? failure.message : "File preparation failed. Try again.",
        );
    } finally {
      if (stillCurrent()) {
        preparing.current = false;
        setPending(false);
      }
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && current()) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Download via server</DialogTitle>
          <DialogDescription>
            This alternative sends a copy of the prepared file to KovaGPT to return a download. It
            is processed in memory and is not saved to your account. Local downloads stay on your
            device. The response opens in a new tab, where any delivery error will appear. Your
            original draft stays here.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={formatId} className="text-sm font-medium">
          File format
        </label>
        <Select
          value={format}
          onValueChange={(value) => setFormat(value as DocumentDeliveryFormat)}
        >
          <SelectTrigger id={formatId} className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={kind === "writing" ? "md" : kind === "website" ? "html" : "txt"}>
              {kind === "writing" ? "Markdown" : kind === "website" ? "HTML" : "Text"}
            </SelectItem>
            {kind === "writing" &&
              ["pdf", "docx", "xlsx", "pptx"].map((value) => (
                <SelectItem key={value} value={value}>
                  {value.toUpperCase()}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          type="button"
          className="border"
          disabled={pending}
          onClick={() => void prepare()}
        >
          {pending ? "Preparing locally…" : "Prepare file locally"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-foreground">
            {error} Your draft is preserved.
          </p>
        )}
        {ready && (
          <form
            method="post"
            action={DOCUMENT_EXPORT_PATH}
            target="_blank"
            rel="noopener"
            encType="application/x-www-form-urlencoded"
            acceptCharset="UTF-8"
            onSubmit={(event) => {
              if (
                !current() ||
                submitted.current ||
                latest.current.title !== ready.title ||
                latest.current.content !== ready.content ||
                latest.current.format !== ready.format
              ) {
                event.preventDefault();
                return;
              }
              submitted.current = true;
              // Let the native form serialize before removing its transient fields.
              cleanupTimer.current = setTimeout(() => {
                if (!active.current) return;
                setPrepared(null);
                if (current()) setRequested(true);
              }, 0);
            }}
          >
            <input type="hidden" name="format" value={ready.format} />
            <input type="hidden" name="filename" value={ready.filename} />
            <input type="hidden" name="bytes" value={ready.bytes} />
            <p className="mb-3 break-words text-sm">Ready: {ready.filename}</p>
            <Button variant="default" type="submit" className="bg-primary text-primary-foreground">
              Send file and download
            </Button>
          </form>
        )}
        {requested && (
          <p role="status" className="text-sm">
            Download requested. Check your browser’s downloads or the new tab for an error. Prepare
            the file again to retry.
          </p>
        )}
        <Button
          variant="outline"
          type="button"
          className="border"
          onClick={() => {
            if (current()) onClose();
          }}
        >
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
