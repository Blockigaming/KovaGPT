import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, MailMinus } from "lucide-react";
import { z } from "zod";

const SearchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: SearchSchema,
  component: UnsubscribePage,
  head: () => ({
    meta: [{ title: "KovaGPT Unsubscribe" }, { name: "robots", content: "noindex" }],
  }),
});

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "already" }
  | { kind: "invalid" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

function UnsubscribePage() {
  const { token } = useSearch({ from: "/unsubscribe" });
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    if (!token) {
      setStatus({ kind: "invalid" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`);
        const data = (await res.json().catch(() => ({}))) as {
          valid?: boolean;
          reason?: string;
          error?: string;
        };
        if (!alive) return;
        if (!res.ok || data.error) {
          setStatus({ kind: "invalid" });
          return;
        }
        if (data.valid) setStatus({ kind: "ready" });
        else if (data.reason === "already_unsubscribed") setStatus({ kind: "already" });
        else setStatus({ kind: "invalid" });
      } catch {
        if (alive) setStatus({ kind: "error", message: "Network error. Please try again." });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(`/email/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error || "Failed to unsubscribe." });
        return;
      }
      if (data.success) setStatus({ kind: "done" });
      else if (data.reason === "already_unsubscribed") setStatus({ kind: "already" });
      else setStatus({ kind: "error", message: "Unable to unsubscribe." });
    } catch {
      setStatus({ kind: "error", message: "Network error. Please try again." });
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-foreground/5 flex items-center justify-center mb-4">
          <MailMinus className="w-6 h-6" />
        </div>
        {status.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Checking your unsubscribe link…
          </div>
        )}
        {status.kind === "ready" && (
          <>
            <h1 className="text-xl font-semibold mb-2">Unsubscribe from KovaGPT emails</h1>
            <p className="text-sm text-muted-foreground mb-6">
              You'll stop receiving non-essential emails from KovaGPT. Account and security messages
              will still be delivered.
            </p>
            <Button onClick={confirm} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}
        {status.kind === "submitting" && (
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Unsubscribing…
          </div>
        )}
        {status.kind === "done" && (
          <>
            <CheckCircle2 className="mx-auto w-8 h-8 text-foreground mb-2" />
            <h1 className="text-xl font-semibold mb-2">You're unsubscribed</h1>
            <p className="text-sm text-muted-foreground">
              We won't email you again. If this was a mistake, contact support@kovagpt.com.
            </p>
          </>
        )}
        {status.kind === "already" && (
          <>
            <CheckCircle2 className="mx-auto w-8 h-8 text-foreground mb-2" />
            <h1 className="text-xl font-semibold mb-2">Already unsubscribed</h1>
            <p className="text-sm text-muted-foreground">This address is already opted out.</p>
          </>
        )}
        {status.kind === "invalid" && (
          <>
            <XCircle className="mx-auto w-8 h-8 text-muted-foreground mb-2" />
            <h1 className="text-xl font-semibold mb-2">Link not valid</h1>
            <p className="text-sm text-muted-foreground">
              This unsubscribe link is invalid or has expired. Please use the link from the latest
              email.
            </p>
          </>
        )}
        {status.kind === "error" && (
          <>
            <XCircle className="mx-auto w-8 h-8 text-muted-foreground mb-2" />
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">{status.message}</p>
          </>
        )}
      </div>
    </div>
  );
}
