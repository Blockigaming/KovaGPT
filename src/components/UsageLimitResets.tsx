import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMyChatLimitResets, redeemMyChatLimitReset } from "@/utils/usage.functions";
import { canGrantUsageResets, grantUsageReset } from "@/utils/usage-reset-admin.functions";
import type { BillingTier } from "@/lib/billing-plans";

type Resets = Awaited<ReturnType<typeof getMyChatLimitResets>>;
const formatDate = (date: string) => new Date(date).toLocaleString();

export function UsageLimitResets({
  ownerId,
  tier,
  onReset,
}: {
  ownerId: string;
  tier: BillingTier;
  onReset: () => void;
}) {
  const [rows, setRows] = useState<Resets | null>(null);
  const [admin, setAdmin] = useState(false);
  const [history, setHistory] = useState(false);
  const [weekly, setWeekly] = useState(true);
  const [fiveHour, setFiveHour] = useState(true);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [refresh, setRefresh] = useState(0);
  const grantId = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    void getMyChatLimitResets({ data: { ownerId } }).then(
      (result) => {
        if (current) setRows(result);
      },
      () => {
        if (current) setStatus("Resets are temporarily unavailable.");
      },
    );
    return () => {
      current = false;
    };
  }, [ownerId, refresh]);
  useEffect(() => {
    let current = true;
    void canGrantUsageResets().then(
      (result) => {
        if (current) setAdmin(result);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [ownerId]);

  const available = rows?.filter(
    (row) => !row.redeemedAt && Date.parse(row.expiresAt) > Date.now(),
  );
  const activity = rows
    ?.flatMap((row) => [
      {
        id: row.id + ":grant",
        label: row.manual ? "Compensation reset received" : "Reset received",
        date: row.grantedAt,
      },
      ...(row.redeemedAt
        ? [{ id: row.id + ":use", label: "Reset used", date: row.redeemedAt }]
        : []),
    ])
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <section className="kova-settings-section space-y-4">
      <h3>Usage limit resets</h3>
      <p className="text-sm text-muted-foreground">
        {tier === "free"
          ? "You receive one reset each month."
          : "You receive one reset every two weeks."}{" "}
        Each reset expires one month after it is granted.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reset views">
        <Button
          type="button"
          variant={history ? "ghost" : "secondary"}
          className="rounded-full"
          aria-pressed={!history}
          onClick={() => setHistory(false)}
        >
          Available {available?.length ?? ""}
        </Button>
        <Button
          type="button"
          variant={history ? "secondary" : "ghost"}
          className="rounded-full"
          aria-pressed={history}
          onClick={() => setHistory(true)}
        >
          History
        </Button>
      </div>
      {!rows ? (
        <Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          Refresh resets
        </Button>
      ) : history ? (
        activity?.length ? (
          <ul className="divide-y divide-border">
            {activity.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{event.label}</span>
                <time dateTime={event.date}>{formatDate(event.date)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>No reset history.</p>
        )
      ) : available?.length ? (
        <>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm">Restore included usage</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={weekly}
                onChange={(event) => setWeekly(event.target.checked)}
              />
              Weekly
            </label>
            {tier !== "pro" && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fiveHour}
                  onChange={(event) => setFiveHour(event.target.checked)}
                />
                5-hour
              </label>
            )}
          </fieldset>
          <ul className="divide-y divide-border">
            {available.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>Expires {formatDate(row.expiresAt)}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || (!weekly && (tier === "pro" || !fiveHour))}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await redeemMyChatLimitReset({
                        data: { ownerId, id: row.id, weekly, fiveHour: tier !== "pro" && fiveHour },
                      });
                      setRows((previous) => previous?.filter((item) => item.id !== row.id) ?? null);
                      setStatus("Reset applied.");
                      onReset();
                    } catch {
                      setStatus("This reset could not be applied.");
                    } finally {
                      setRefresh((value) => value + 1);
                      setPending(false);
                    }
                  }}
                >
                  Use reset
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No resets available.</p>
      )}
      {admin && (
        <form
          className="space-y-3 border-t border-border pt-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            grantId.current ??= crypto.randomUUID();
            setPending(true);
            try {
              await grantUsageReset({
                data: {
                  recipient: String(data.get("account") ?? "").trim(),
                  reason: String(data.get("reason") ?? "").trim(),
                  requestId: grantId.current,
                },
              });
              grantId.current = null;
              form.reset();
              setStatus("Compensation reset granted.");
              setRefresh((value) => value + 1);
            } catch {
              setStatus("Reset grant failed.");
            } finally {
              setPending(false);
            }
          }}
        >
          <h4 className="font-medium">Grant a compensation reset</h4>
          <label className="block text-sm">
            Account ID
            <Input name="account" required maxLength={36} />
          </label>
          <label className="block text-sm">
            Reason
            <Input name="reason" required maxLength={240} />
          </label>
          <Button type="submit" disabled={pending}>
            Grant reset
          </Button>
        </form>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </section>
  );
}
