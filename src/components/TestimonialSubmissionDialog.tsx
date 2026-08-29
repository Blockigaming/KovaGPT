import { useState } from "react";
import { toast } from "sonner";
import { submitTestimonial } from "@/lib/testimonials.functions";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function TestimonialSubmissionDialog({ open, onClose }: Props) {
  const [quote, setQuote] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [displayRole, setDisplayRole] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit() {
    if (!consent) {
      toast.error("Publishing permission is required.");
      return;
    }

    setBusy(true);
    try {
      await submitTestimonial({
        data: {
          quote,
          displayName,
          displayRole: displayRole.trim() || undefined,
          consentToPublish: true,
        },
      });
      toast.success("Testimonial submitted for review.");
      setQuote("");
      setDisplayName("");
      setDisplayRole("");
      setConsent(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit testimonial.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="testimonial-dialog-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl"
      >
        <h2 id="testimonial-dialog-title" className="text-lg font-semibold">
          Share your experience
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Submissions are reviewed before publication. Nothing is published automatically.
        </p>

        <label className="mt-5 block text-sm font-medium">
          Your testimonial
          <textarea
            className="mt-2 min-h-32 w-full rounded-xl border border-border bg-transparent p-3"
            value={quote}
            maxLength={1000}
            onChange={(event) => setQuote(event.target.value)}
            placeholder="Tell us what KovaGPT helped you accomplish."
          />
        </label>

        <label className="mt-4 block text-sm font-medium">
          Display name
          <input
            className="mt-2 w-full rounded-xl border border-border bg-transparent p-3"
            value={displayName}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label className="mt-4 block text-sm font-medium">
          Role or description (optional)
          <input
            className="mt-2 w-full rounded-xl border border-border bg-transparent p-3"
            value={displayRole}
            maxLength={160}
            onChange={(event) => setDisplayRole(event.target.value)}
          />
        </label>

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1"
          />
          <span>
            I give KovaGPT permission to publish this testimonial and the display information above
            if it is approved.
          </span>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm hover:bg-muted"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
            disabled={busy || !consent || quote.trim().length < 20 || !displayName.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </div>
      </div>
    </div>
  );
}
