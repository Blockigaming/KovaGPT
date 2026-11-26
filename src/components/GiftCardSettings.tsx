import { useEffect, useId, useRef, useState } from "react";
import { PackageOpen as Gift, Mail, MessageSquare as Smartphone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CONSUMER_MODELS } from "@/lib/consumer-model-selection.mjs";
import { canBuyUsageCredits, canUseCreditsForModel } from "@/lib/usage-credit-pricing.mjs";
import { createUsageCreditCheckout, getMyUsageWallet } from "@/utils/usage-wallet.functions";
import type { BillingTier } from "@/lib/billing-plans";

const amounts = ["25", "50", "100", "custom"] as const;
const deliveryOptions = [
  { id: "email", label: "Email", icon: Mail },
  { id: "text", label: "Text", icon: Smartphone },
  { id: "self", label: "Self-send", icon: UserRound },
] as const;
const designs = [
  { name: "Midnight", color: "linear-gradient(140deg, #152043, #322466, #693b85)" },
  { name: "Evergreen", color: "linear-gradient(140deg, #092e31, #17543c, #2c6443)" },
  { name: "Ember", color: "linear-gradient(140deg, #471c37, #7f3143, #aa472b)" },
] as const;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function UsageCredits({
  tier,
  onOpenGiftCards,
}: {
  tier: BillingTier | undefined;
  onOpenGiftCards: () => void;
}) {
  return (
    <section className="kova-settings-section space-y-3">
      <h3>Credits and gift cards</h3>
      {tier && (
        <div>
          <h4 className="text-sm font-medium">Models on your plan</h4>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Models on your plan">
            {CONSUMER_MODELS.filter((model) => canUseCreditsForModel(tier, model.id)).map(
              (model) => (
                <li key={model.id} className="rounded-full bg-muted px-3 py-1 text-sm">
                  {model.label}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {canBuyUsageCredits(tier)
          ? "Usage credits are coming soon. They cover extra usage on models included in your plan, after your included usage runs out."
          : "Usage credits are coming soon."}
      </p>
      <Button type="button" variant="outline" onClick={onOpenGiftCards}>
        <Gift aria-hidden="true" />
        Gift cards
      </Button>
    </section>
  );
}

export function GiftCardSettings({ ownerId }: { ownerId?: string }) {
  const [checkoutMode, setCheckoutMode] = useState<"live" | "sandbox" | null>(null);
  const checkoutEnabled = checkoutMode !== null;
  const [deliveryAvailability, setDeliveryAvailability] = useState({ email: false, text: false });
  const [pending, setPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let current = true;
    void getMyUsageWallet({ data: { ownerId } }).then(
      (wallet) => {
        if (current) {
          setCheckoutMode(wallet?.environment ?? null);
          if (wallet) {
            setDeliveryAvailability(wallet.delivery);
            setDelivery(wallet.delivery.email ? "email" : wallet.delivery.text ? "text" : "self");
          }
        }
      },
      () => {
        if (current) setCheckoutError("Gift checkout is temporarily unavailable.");
      },
    );
    return () => {
      current = false;
    };
  }, [ownerId]);
  const id = useId();
  const [amount, setAmount] = useState<(typeof amounts)[number]>("50");
  const [customAmount, setCustomAmount] = useState("");
  const [delivery, setDelivery] = useState<(typeof deliveryOptions)[number]["id"]>("email");
  const [design, setDesign] = useState<(typeof designs)[number]>(designs[0]);
  const [showLogo, setShowLogo] = useState(true);
  const [message, setMessage] = useState("");
  const value = amount === "custom" ? customAmount : amount;
  const validAmount =
    /^\d{1,3}(?:\.\d{1,2})?$/.test(value) && Number(value) >= 5 && Number(value) <= 500;

  return (
    <section className="kova-settings-section space-y-5">
      <p className="text-sm text-muted-foreground">
        {checkoutEnabled
          ? checkoutMode === "sandbox"
            ? "Stripe sandbox. Choose how to send your test gift card."
            : "Choose how to send your gift card."
          : "Gift cards will be available on every Kova plan, including Free."}
      </p>
      <form
        className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ownerId || !checkoutEnabled || !validAmount || pending) return;
          const cents = Math.round(Number(value) * 100);
          const fields = new FormData(event.currentTarget);
          const details = {
            channel: delivery,
            to: String(fields.get("to") ?? ""),
            recipient: String(fields.get("recipient") ?? ""),
            sender: String(fields.get("sender") ?? ""),
            message,
          };
          const signature = JSON.stringify([cents, design.name, showLogo, details]);
          if (attempt.current?.signature !== signature)
            attempt.current = { signature, id: crypto.randomUUID() };
          setPending(true);
          setCheckoutError("");
          try {
            const url = await createUsageCreditCheckout({
              data: {
                ownerId,
                orderId: attempt.current.id,
                cents,
                gift: true,
                design: design.name,
                showLogo,
                delivery: details,
              },
            });
            window.location.assign(url);
          } catch {
            setPending(false);
            setCheckoutError("Gift checkout couldn’t be opened. Try again.");
          }
        }}
      >
        <div className="min-w-0 space-y-4">
          <figure
            className="flex aspect-[8/5] flex-col justify-end rounded-2xl p-5 text-white"
            style={{ background: design.color }}
          >
            {showLogo && (
              <figcaption className="mb-auto flex items-center gap-2 text-sm font-semibold">
                <img
                  src="/kova-favicon-20260807.png"
                  alt=""
                  width={22}
                  height={22}
                  className="shrink-0 object-contain"
                />
                KovaGPT
              </figcaption>
            )}
            <p className="break-words text-3xl font-semibold tabular-nums">
              {validAmount ? usd.format(Number(value)) : "Gift card"}
            </p>
          </figure>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">Card design</legend>
            <div className="flex flex-wrap gap-2">
              {designs.map((option) => (
                <Button
                  key={option.name}
                  type="button"
                  variant="ghost"
                  aria-pressed={design === option}
                  className="min-h-11 rounded-xl bg-muted/70 aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90 hover:aria-pressed:text-primary-foreground"
                  onClick={() => setDesign(option)}
                >
                  <span
                    className="size-3 rounded-full"
                    style={{ background: option.color }}
                    aria-hidden="true"
                  />
                  {option.name}
                </Button>
              ))}
            </div>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm">
              Show KovaGPT logo
              <Switch checked={showLogo} onCheckedChange={setShowLogo} />
            </label>
          </fieldset>
        </div>
        <div className="min-w-0 space-y-4">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">Amount (USD)</legend>
            <div className="flex flex-wrap gap-2">
              {amounts.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant="ghost"
                  aria-pressed={amount === option}
                  className="min-h-11 rounded-xl bg-muted/70 aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90 hover:aria-pressed:text-primary-foreground"
                  onClick={() => setAmount(option)}
                >
                  {option === "custom" ? "Other" : `$${option}`}
                </Button>
              ))}
            </div>
            {amount === "custom" && (
              <label className="mt-3 block space-y-1 text-sm">
                <span>Custom amount</span>
                <Input
                  inputMode="decimal"
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  maxLength={6}
                />
              </label>
            )}
          </fieldset>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">
              {checkoutEnabled ? "Delivery" : "Delivery preview"}
            </legend>
            <div className="flex flex-wrap gap-2">
              {deliveryOptions.map(({ id: option, label, icon: Icon }) => (
                <Button
                  key={option}
                  type="button"
                  variant="ghost"
                  aria-pressed={delivery === option}
                  disabled={checkoutEnabled && option !== "self" && !deliveryAvailability[option]}
                  className="min-h-11 rounded-xl bg-muted/70 aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90 hover:aria-pressed:text-primary-foreground"
                  onClick={() => setDelivery(option)}
                >
                  <Icon aria-hidden="true" /> {label}
                </Button>
              ))}
            </div>
          </fieldset>
          {delivery !== "self" && (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">Gift details</legend>
              <label className="block space-y-1 text-sm">
                <span>Recipient’s name</span>
                <Input name="recipient" autoComplete="off" maxLength={80} />
              </label>
              <label key={delivery} className="block space-y-1 text-sm">
                <span>
                  {delivery === "email" ? "Recipient’s email address" : "Recipient’s phone number"}
                </span>
                <Input
                  name="to"
                  type={delivery === "email" ? "email" : "tel"}
                  autoComplete="off"
                  required={checkoutEnabled}
                  maxLength={254}
                  placeholder={delivery === "text" ? "+1…" : undefined}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Gift message</span>
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={180}
                  aria-describedby={id}
                />
                <span id={id} className="block text-end text-xs text-muted-foreground">
                  {message.length}/180
                </span>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Sender’s name</span>
                <Input name="sender" autoComplete="off" maxLength={80} />
              </label>
            </fieldset>
          )}
          {checkoutEnabled && (
            <Button type="submit" disabled={pending || !validAmount}>
              {pending
                ? "Opening checkout…"
                : checkoutMode === "sandbox"
                  ? "Buy test gift card"
                  : "Buy gift card"}
            </Button>
          )}
          {checkoutError && (
            <p role="alert" className="text-sm">
              {checkoutError}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
