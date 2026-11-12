import "./free-offer.css";
import { useEffect, useRef, useState, useSyncExternalStore, type SVGProps } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { useUser } from "@/components/auth/ClerkSafe";
import { getFreeOfferEligibility } from "@/lib/free-offer-eligibility.functions";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { TABLET_MAX } from "@/hooks/use-mobile";

const narrowLayout = `(max-width: ${TABLET_MAX - 1}px)`;
function subscribeToLayout(change: () => void) {
  const query = window.matchMedia(narrowLayout);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
const readLayout = () => window.matchMedia(narrowLayout).matches;
const readServerLayout = () => null;

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

export function FreeOfferButton({
  variant = "toolbar",
  narrow,
}: {
  variant?: "toolbar" | "sidebar";
  narrow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const price = CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd;
  const { user, isLoaded, isSignedIn } = useUser();
  const compact = useSyncExternalStore(subscribeToLayout, readLayout, readServerLayout);
  const visible = narrow === undefined || narrow === compact;
  const ownerRef = useRef<string | null>(null);
  ownerRef.current = visible && isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const attemptRef = useRef<symbol | null>(null);
  const [claimStatus, setClaimStatus] = useState<"checking" | "ineligible" | "unavailable" | null>(
    null,
  );
  const [offer, setOffer] = useState<{ owner: string; eligible: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOpen(false);
    setOffer(null);
    setClaimStatus(null);
    attemptRef.current = null;
    if (!visible || !isLoaded || !isSignedIn || !user?.id) return;
    const owner = user.id;
    void getFreeOfferEligibility({ data: { expectedOwnerId: owner } })
      .then((result) => {
        if (!cancelled && ownerRef.current === owner) {
          const eligible = result.eligible === true;
          setOffer({ owner, eligible });
          if (eligible && variant === "toolbar") {
            publishKovaNotice({
              id: "offer_available",
              key: "monthly-intro-v1",
              campaignId: "monthly-intro-v1",
              title: "A Plus offer is available",
              message:
                "Your account qualifies for an introductory subscription offer. Check the price and renewal terms before choosing a plan.",
              confirmed: true,
              primaryLabel: "See offer",
              onPrimary: () => {
                if (ownerRef.current === owner) setOpen(true);
              },
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setOffer({ owner, eligible: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user?.id, variant, visible]);
  // A free plan or a personal email address is not proof of promotional
  // eligibility. Never show the CTA before server verification.
  if (!visible || !user?.id || !isSignedIn || offer?.owner !== user.id || !offer.eligible)
    return null;
  const owner = user.id;
  const ineligible = claimStatus === "ineligible";
  const changeOpen = (next: boolean) => {
    if (!next) {
      attemptRef.current = null;
      if (claimStatus === "ineligible") setOffer({ owner, eligible: false });
      setClaimStatus(null);
    }
    setOpen(next);
  };
  const claim = async () => {
    if (ownerRef.current !== owner || attemptRef.current) return;
    const attempt = Symbol();
    attemptRef.current = attempt;
    const current = () => attemptRef.current === attempt && ownerRef.current === owner;
    setClaimStatus("checking");
    try {
      const result = await getFreeOfferEligibility({ data: { expectedOwnerId: owner } });
      if (!current()) return;
      if (!result.eligible) {
        setClaimStatus(result.reason === "ineligible" ? "ineligible" : "unavailable");
        return;
      }
      changeOpen(false);
      void navigate({
        to: "/subscribe" as never,
        search: { plan: "plus_monthly" } as never,
      });
    } catch {
      if (current()) setClaimStatus("unavailable");
    } finally {
      if (current()) attemptRef.current = null;
    }
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            variant === "sidebar" ? "kova-free-offer kova-free-offer-sidebar" : "kova-free-offer"
          }
          aria-label={
            variant === "sidebar"
              ? "Claim introductory Plus offer"
              : "Free offer: 50% off your first month"
          }
          data-free-introductory-offer="true"
        >
          <Gift aria-hidden="true" size={18} />
          <span>{variant === "sidebar" ? "Claim offer" : "Free offer"}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="kova-free-offer-dialog max-w-md rounded-3xl p-7"
        onCloseAutoFocus={(event) => {
          if (!ineligible) return;
          const target =
            (variant === "sidebar" &&
              document.querySelector<HTMLButtonElement>(".kova-account-main")) ||
            document.getElementById("main-content");
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <Gift aria-hidden="true" className="mb-3 h-9 w-9 text-sky-500" />
          <DialogTitle>
            {ineligible ? "This offer is unavailable" : "50% off your first month of Plus"}
          </DialogTitle>
          {ineligible ? (
            <DialogDescription role="status" data-kova-notice-id="offer_ineligible">
              This introductory offer is unavailable for your account.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Get Kova Plus for ${price / 2} for your first month, then ${price}/month. Prices are
              before tax. Available once per eligible account.
            </DialogDescription>
          )}
        </DialogHeader>
        <Button
          className="mt-4 min-h-11 rounded-full"
          disabled={claimStatus === "checking"}
          onClick={() => (ineligible ? changeOpen(false) : void claim())}
        >
          {claimStatus === "checking"
            ? "Checking eligibility…"
            : ineligible
              ? "Done"
              : "Get 50% off Plus"}
        </Button>
        {claimStatus === "unavailable" && (
          <p role="alert" className="text-sm text-destructive">
            The offer could not be verified. Try again.
          </p>
        )}
        {!ineligible && (
          <p className="text-xs text-muted-foreground">
            Offer eligibility and the final price are rechecked at checkout. Review the amount and
            renewal terms before paying.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
