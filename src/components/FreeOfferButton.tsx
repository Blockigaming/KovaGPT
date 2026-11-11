import "./free-offer.css";
import { useEffect, useState, type SVGProps } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { useUser } from "@/components/auth/ClerkSafe";
import { getFreeOfferEligibility } from "@/lib/free-offer-eligibility.functions";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";

function Gift({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="8" width="18" height="4" rx="1.5" />
      <path d="M5 12v8h14v-8M12 8v12M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" />
    </svg>
  );
}

export function FreeOfferButton({ variant = "toolbar" }: { variant?: "toolbar" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const price = CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd;
  const { user, isLoaded, isSignedIn } = useUser();
  const [offer, setOffer] = useState<{ owner: string; eligible: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOpen(false);
    setOffer(null);
    if (!isLoaded || !isSignedIn || !user?.id) return;
    const owner = user.id;
    void getFreeOfferEligibility().then((result) => {
      if (!cancelled) {
        const eligible = result.eligible === true;
        setOffer({ owner, eligible });
        if (eligible && variant === "toolbar") {
          publishKovaNotice({
            id: "offer_available",
            key: "monthly-intro-v1",
            campaignId: "monthly-intro-v1",
            title: "A Plus offer is available",
            message: "Your account qualifies for an introductory subscription offer. Check the price and renewal terms before choosing a plan.",
            confirmed: true,
            primaryLabel: "See offer",
            onPrimary: () => void navigate({
              to: "/subscribe" as never,
              search: { plan: "plus_monthly" } as never,
            }),
          });
        }
      }
    }).catch(() => {
      if (!cancelled) setOffer({ owner, eligible: false });
    });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, user?.id, variant, navigate]);
  // A free plan or a personal email address is not proof of promotional
  // eligibility. Never show the CTA before server verification.
  if (!user?.id || !isSignedIn || offer?.owner !== user.id || !offer.eligible) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variant === "sidebar" ? "kova-free-offer kova-free-offer-sidebar" : "kova-free-offer"}
        aria-label={variant === "sidebar" ? "Claim introductory Plus offer" : "Free offer: 50% off your first month"}
        data-free-introductory-offer="true"
      >
        <Gift aria-hidden="true" size={18} />
        <span>{variant === "sidebar" ? "Claim offer" : "Free offer"}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-3xl p-7">
          <DialogHeader>
            <Gift aria-hidden="true" className="mb-3 h-9 w-9 text-sky-500" />
            <DialogTitle>50% off your first month of Plus</DialogTitle>
            <DialogDescription>
              Get Kova Plus for ${price / 2} for your first month, then ${price}/month. Prices are
              before tax. Available once per eligible account.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="mt-4 min-h-11 rounded-full"
            onClick={() => {
              setOpen(false);
              void navigate({
                to: "/subscribe" as never,
                search: { plan: "plus_monthly" } as never,
              });
            }}
          >
            Get 50% off Plus
          </Button>
          <p className="text-xs text-muted-foreground">
            Offer eligibility and the final price are rechecked at checkout. Review the amount and renewal terms before paying.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
