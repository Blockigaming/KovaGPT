import "./free-offer.css";
import { useState, type SVGProps } from "react";
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

export function FreeOfferButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const price = CAPABILITY_REGISTRY.plans.plus.monthlyPriceUsd;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kova-free-offer"
        aria-label="Free offer: 50% off your first month"
        data-free-introductory-offer="true"
      >
        <Gift aria-hidden="true" size={18} />
        <span>Free offer</span>
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
            Your discount is applied automatically. Review your first payment and renewal terms at
            checkout.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
