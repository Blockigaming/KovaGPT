import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listStaleCreditHolds,
  reconcileStaleCreditHold,
} from "@/utils/usage-reset-admin.functions";

export function CreditHoldReview({
  ownerId,
  onReconciled,
}: {
  ownerId: string;
  onReconciled: () => void;
}) {
  const [holds, setHolds] = useState<Awaited<ReturnType<typeof listStaleCreditHolds>>>(null);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let current = true;
    void listStaleCreditHolds().then(
      (rows) => {
        if (current) setHolds(rows);
      },
      () => {
        if (current) setStatus("Credit holds could not be loaded.");
      },
    );
    return () => {
      current = false;
    };
  }, [ownerId, refresh]);

  if (!holds && !status) return null;
  return (
    <section className="kova-settings-section space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>Expired credit holds</h3>
        <Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
      {holds?.length === 0 && (
        <p className="text-sm text-muted-foreground">No holds need review.</p>
      )}
      {holds?.map((hold) => (
        <details key={hold.event_id} className="border-t border-border py-3">
          <summary className="cursor-pointer break-words text-sm">
            {hold.model} · {new Date(hold.created_at).toLocaleString()}
          </summary>
          <p className="mt-2 break-all text-sm">Request ID {hold.request_id}</p>
          <p className="text-sm">Reserved ${(hold.maximum_micros / 1_000_000).toFixed(6)}</p>
          <form
            className="mt-3 space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setPending(true);
              setStatus("");
              try {
                await reconcileStaleCreditHold({
                  data: {
                    ownerId,
                    eventId: hold.event_id,
                    actualUsd: String(data.get("actualUsd") ?? ""),
                    reason: String(data.get("reason") ?? ""),
                  },
                });
                setHolds((rows) => rows?.filter((row) => row.event_id !== hold.event_id) ?? null);
                setStatus("Credit hold reconciled.");
                onReconciled();
              } catch {
                setStatus("The hold could not be reconciled. Refresh and verify its status.");
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block text-sm">
              Verified provider cost in USD
              <Input name="actualUsd" inputMode="decimal" required maxLength={12} />
            </label>
            <label className="block text-sm">
              Evidence or reason
              <Input name="reason" required maxLength={240} />
            </label>
            <Button type="submit" disabled={pending}>
              Resolve hold
            </Button>
          </form>
        </details>
      ))}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </section>
  );
}
