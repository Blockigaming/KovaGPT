import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
type Offer = {
  id: string;
  name: string;
  currency: string;
  subtotal_amount: number;
  credits_amount: number;
  tax_mode: string;
};
type Funding = {
  enabled: boolean;
  offers: Offer[];
  attempts: { id: string; state: string; checkout_url: string | null; created_at: string }[];
  page: number;
  hasMore: boolean;
};
function money(amount: number, currency: string) {
  const format = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits;
  if (digits === undefined) return `${amount} ${currency} minor units`;
  return format.format(amount / 10 ** digits);
}
function checkoutUrl(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function DeveloperFundingPanel({
  userId,
  accountId,
  onBalanceChanged,
}: {
  userId: string;
  accountId: string;
  onBalanceChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<Funding | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0),
    loadVersion = useRef(0);
  const active = useRef(true),
    requestKeys = useRef(new Map<string, string>());
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++loadVersion.current;
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/funding?accountId=${encodeURIComponent(accountId)}&page=${page}`,
        { signal, headers: { "X-Kova-Expected-User": userId } },
      );
      const value = await response.json();
      if (!response.ok) throw new Error("Could not load payment status.");
      if (active.current && !signal?.aborted && version === loadVersion.current) setData(value);
    },
    [accountId, userId, page],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    load(controller.signal).catch(() => {
      if (active.current && !controller.signal.aborted) setError("Could not load payment status.");
    });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [load]);
  const purchase = async (offer: Offer) => {
    setBusy(true);
    setError("");
    let requestKey = requestKeys.current.get(offer.id);
    if (!requestKey) {
      requestKey = crypto.randomUUID();
      requestKeys.current.set(offer.id, requestKey);
    }
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/developer/funding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kova-Expected-User": userId,
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({ accountId, offerId: offer.id }),
      });
      const value = await response.json();
      if (!active.current) return;
      if (!response.ok)
        throw new Error(
          value.message ?? "Your checkout is pending. Retry to check the same payment.",
        );
      if (value.state === "paid" || value.state === "expired") requestKeys.current.delete(offer.id);
      if (value.checkout_url) {
        const url = new URL(value.checkout_url);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "checkout.stripe.com" ||
          url.username ||
          url.password
        )
          throw new Error("The checkout link could not be verified.");
        window.location.assign(url.href);
      } else {
        setError(
          value.state === "paid"
            ? "Payment is verified. Your credit balance is ready to refresh."
            : value.state === "expired"
              ? "This checkout expired. You can start a new purchase."
              : "Checkout status is pending. Refresh its status before starting another purchase.",
        );
        await load();
        await onBalanceChanged?.();
      }
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : "Could not open checkout.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Prepaid API credit</h2>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data && !data.enabled ? (
        <p className="text-sm text-muted-foreground">Credit purchases are not available yet.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Choose an approved credit offer. Stripe confirms the final payment and any applicable
            tax before you pay. Credit appears after payment verification.
          </p>
          <ul className="space-y-3">
            {data?.offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p>{offer.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {money(offer.credits_amount, offer.currency)} API credit ·{" "}
                    {money(offer.subtotal_amount, offer.currency)}
                    {offer.tax_mode === "automatic" ? " before tax" : ""}
                  </p>
                </div>
                <Button disabled={busy} onClick={() => void purchase(offer)}>
                  Continue to checkout
                </Button>
              </li>
            ))}
          </ul>
          {!data?.offers.length && (
            <p className="text-sm">No approved credit offers are currently available.</p>
          )}
        </>
      )}
      <h3 className="font-medium">Payment history</h3>
      <ul className="space-y-2 text-sm">
        {data?.attempts.map((item) => (
          <li key={item.id}>
            {new Date(item.created_at).toLocaleString()} · {item.state.replaceAll("_", " ")}
            {item.state === "open" && checkoutUrl(item.checkout_url) && (
              <a className="ml-3 underline" href={checkoutUrl(item.checkout_url)!}>
                Resume checkout
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={busy || page === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
        >
          Previous payments
        </Button>
        <span>Page {page + 1}</span>
        <Button
          variant="outline"
          disabled={busy || !data?.hasMore}
          onClick={() => setPage((value) => value + 1)}
        >
          Next payments
        </Button>
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setError("");
          load()
            .then(() => onBalanceChanged?.())
            .catch(() => setError("Could not refresh payment status."));
        }}
      >
        Refresh payment status
      </Button>
    </section>
  );
}
