import { CreditHoldReview } from "@/components/CreditHoldReview";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createUsageCreditCheckout,
  getMyUsageWallet,
  redeemUsageCreditGift,
  type UsageWallet as Wallet,
} from "@/utils/usage-wallet.functions";

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function UsageWallet({ ownerId, gift = false }: { ownerId: string; gift?: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    void getMyUsageWallet({ data: { ownerId } }).then(
      (data) => {
        if (active) setWallet(data);
      },
      () => {
        if (active) setStatus("Credit wallet unavailable.");
      },
    );
    return () => {
      active = false;
    };
  }, [ownerId, revision]);

  if (wallet === null) return null;
  return (
    <section className="kova-settings-section space-y-4">
      <h3>{gift ? "Gift card checkout" : "Credit wallet"}</h3>
      {!gift && (
        <CreditHoldReview
          ownerId={ownerId}
          onReconciled={() => setRevision((value) => value + 1)}
        />
      )}
      {wallet === undefined ? (
        <Button variant="outline" type="button" onClick={() => setRevision((value) => value + 1)}>
          Refresh wallet
        </Button>
      ) : (
        <>
          {wallet.environment === "sandbox" && (
            <p className="text-sm text-muted-foreground">Stripe sandbox. Test payments only.</p>
          )}
          {!gift && (
            <p>
              {wallet.environment === "sandbox" ? "Test balance" : "Available credits"}{" "}
              {usd.format(wallet.availableMicros / 1_000_000)}
            </p>
          )}
          {!gift && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const value = String(new FormData(event.currentTarget).get("amount"));
                if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return;
                setPending(true);
                try {
                  const url = await createUsageCreditCheckout({
                    data: {
                      ownerId,
                      orderId: crypto.randomUUID(),
                      cents: Math.round(Number(value) * 100),
                      gift,
                    },
                  });
                  window.location.assign(url);
                } catch {
                  setStatus("Checkout couldn’t be opened.");
                  setPending(false);
                }
              }}
            >
              <label className="block text-sm">
                Amount in USD
                <Input
                  name="amount"
                  type="number"
                  min="5"
                  max="500"
                  step="0.01"
                  defaultValue="25"
                  required
                />
              </label>
              <Button type="submit" disabled={pending}>
                {wallet.environment === "sandbox" ? "Add test credits" : "Add credits"}
              </Button>
            </form>
          )}
          {gift && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const code = String(new FormData(form).get("code")).trim();
                setPending(true);
                try {
                  await redeemUsageCreditGift({ data: { ownerId, code } });
                  form.reset();
                  setStatus("Gift redeemed.");
                  setRevision((value) => value + 1);
                } catch {
                  setStatus("Gift code unavailable.");
                } finally {
                  setPending(false);
                }
              }}
            >
              <label className="block text-sm">
                Gift code
                <Input name="code" autoComplete="off" required maxLength={36} />
              </label>
              <Button type="submit" variant="outline" disabled={pending}>
                Redeem
              </Button>
            </form>
          )}
          {!gift && (
            <div>
              <h4 className="font-medium">Credit spending</h4>
              {wallet.spending.length ? (
                <ul className="divide-y divide-border">
                  {wallet.spending.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                    >
                      <time dateTime={entry.date}>{new Date(entry.date).toLocaleDateString()}</time>
                      <span>{entry.model}</span>
                      <span>
                        {usd.format(entry.micros / 1_000_000)}
                        {entry.needsReview ? " under review" : entry.pending ? " reserved" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No credit spending recorded.</p>
              )}
            </div>
          )}
          <div>
            <h4 className="font-medium">{gift ? "Gift history" : "Credit purchase history"}</h4>
            <ul className="divide-y divide-border">
              {wallet.orders
                .filter((order) => order.gift === gift)
                .map((order) => (
                  <li key={order.id} className="space-y-1 py-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <time dateTime={order.date}>{new Date(order.date).toLocaleDateString()}</time>
                      <span>{usd.format(order.amountCents / 100)}</span>
                    </div>
                    {order.disputed && <p>Payment disputed</p>}
                    {order.refundedCents > 0 && (
                      <p>Refunded {usd.format(order.refundedCents / 100)}</p>
                    )}
                    {order.shareable && order.giftCode && (
                      <div className="space-y-2">
                        <label className="block">
                          Share this gift code
                          <Input
                            readOnly
                            value={order.giftCode}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={`mailto:?subject=${encodeURIComponent(wallet.environment === "sandbox" ? "KovaGPT test gift card" : "KovaGPT gift card")}&body=${encodeURIComponent(`Redeem this gift code in KovaGPT Settings → Gift cards: ${order.giftCode}`)}`}
                            >
                              Send by email
                            </a>
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={`sms:?body=${encodeURIComponent(`KovaGPT gift code: ${order.giftCode}`)}`}
                            >
                              Send by text
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </section>
  );
}
