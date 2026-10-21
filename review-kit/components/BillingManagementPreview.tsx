import { useReducer, useRef, type RefObject } from "react";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BillingPreviewTier = "free" | "plus" | "pro";
export type BillingPreviewState = {
  tier: BillingPreviewTier;
  proposedTier: BillingPreviewTier;
  stage: "overview" | "plan_review" | "cancel_review" | "reactivate_review";
  cancellationScheduled: boolean;
  invoiceId: string | null;
  document: "invoice" | "receipt";
  notice: string;
};
export const SAMPLE_BILLING_INVOICES = [
  {
    id: "sample-invoice-a",
    label: "Sample invoice A",
    period: "Sample billing period A",
    status: "Paid · sample state",
  },
  {
    id: "sample-invoice-b",
    label: "Sample invoice B",
    period: "Sample billing period B",
    status: "Paid · sample state",
  },
] as const;
export function createBillingPreviewState(tier: BillingPreviewTier = "plus"): BillingPreviewState {
  return {
    tier,
    proposedTier: tier,
    stage: "overview",
    cancellationScheduled: false,
    invoiceId: null,
    document: "invoice",
    notice: "",
  };
}
export type BillingPreviewAction =
  | { type: "selectPlan"; tier: BillingPreviewTier }
  | { type: "reviewPlan" }
  | { type: "reviewCancel" }
  | { type: "reviewReactivate" }
  | { type: "confirm" }
  | { type: "back" }
  | { type: "invoice"; id: string }
  | { type: "document"; document: "invoice" | "receipt" }
  | { type: "closeInvoice" }
  | { type: "reset"; tier: BillingPreviewTier };
export function billingPreviewReducer(
  state: BillingPreviewState,
  action: BillingPreviewAction,
): BillingPreviewState {
  switch (action.type) {
    case "selectPlan":
      return state.stage === "overview" && ["free", "plus", "pro"].includes(action.tier)
        ? { ...state, proposedTier: action.tier, notice: "" }
        : state;
    case "reviewPlan":
      return state.stage === "overview" &&
        state.proposedTier !== state.tier &&
        !state.cancellationScheduled
        ? { ...state, stage: "plan_review" }
        : state;
    case "reviewCancel":
      return state.stage === "overview" && state.tier !== "free" && !state.cancellationScheduled
        ? { ...state, stage: "cancel_review" }
        : state;
    case "reviewReactivate":
      return state.stage === "overview" && state.cancellationScheduled
        ? { ...state, stage: "reactivate_review" }
        : state;
    case "confirm":
      if (state.stage === "plan_review")
        return {
          ...state,
          tier: state.proposedTier,
          stage: "overview",
          notice: "Sample plan changed locally. Real amount and effective date remain unresolved.",
        };
      if (state.stage === "cancel_review")
        return {
          ...state,
          cancellationScheduled: true,
          stage: "overview",
          notice:
            "Sample cancellation scheduled locally. No real cancellation or end date was created.",
        };
      if (state.stage === "reactivate_review")
        return {
          ...state,
          cancellationScheduled: false,
          stage: "overview",
          notice:
            "Sample subscription reactivated locally. No payment or real subscription change occurred.",
        };
      return state;
    case "back":
      return { ...state, stage: "overview", proposedTier: state.tier };
    case "invoice":
      return SAMPLE_BILLING_INVOICES.some((invoice) => invoice.id === action.id)
        ? { ...state, invoiceId: action.id, document: "invoice" }
        : state;
    case "document":
      return state.invoiceId ? { ...state, document: action.document } : state;
    case "closeInvoice":
      return { ...state, invoiceId: null, document: "invoice" };
    case "reset":
      return createBillingPreviewState(action.tier);
  }
}

export function BillingManagementPreview({
  open,
  onOpenChange,
  initialTier = "plus",
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTier?: BillingPreviewTier;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const openingUrlRef = useRef<string | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="sm:max-w-2xl"
        closeLabel="Close billing preview"
        onOpenAutoFocus={() => {
          openingUrlRef.current = window.location.href;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const active = document.activeElement;
          restoreDialogFocus(
            returnFocusRef?.current,
            openingUrlRef.current,
            active !== null &&
              active !== document.body &&
              active !== returnFocusRef?.current &&
              !contentRef.current?.contains(active),
          );
        }}
      >
        <DialogHeader>
          <DialogTitle>Billing management preview</DialogTitle>
          <DialogDescription>Sample data · local draft interactions only</DialogDescription>
        </DialogHeader>
        {open && <BillingSession key={initialTier} initialTier={initialTier} />}
      </DialogContent>
    </Dialog>
  );
}

function BillingSession({ initialTier }: { initialTier: BillingPreviewTier }) {
  const [state, dispatch] = useReducer(
    billingPreviewReducer,
    initialTier,
    createBillingPreviewState,
  );
  const label = (tier: BillingPreviewTier) => CAPABILITY_REGISTRY.plans[tier].name;
  const invoice = SAMPLE_BILLING_INVOICES.find((item) => item.id === state.invoiceId);
  const controls = "min-h-11 rounded-xl";
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <p className="rounded-xl border bg-muted/40 p-3 text-sm">
        This sample cannot charge a payment method, change a subscription or retrieve billing
        records. Closing or resetting discards all draft changes.
      </p>
      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">Sample plan: {label(state.tier)}</h3>
        <p className="mt-1 text-sm">
          {state.cancellationScheduled
            ? "Cancellation scheduled · sample state"
            : "No cancellation scheduled · sample state"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Amount, currency, taxes, discounts, refunds, renewal date and change timing: owner
          decision required. No terms are inferred from this preview.
        </p>
      </div>
      {state.notice && (
        <p role="status" className="rounded-xl border p-3 text-sm">
          {state.notice}
        </p>
      )}
      {state.stage === "overview" ? (
        <section aria-label="Sample subscription actions" className="space-y-3">
          <label className="grid gap-2 text-sm font-medium">
            Proposed plan
            <select
              className="min-h-11 w-full rounded-xl border bg-background px-3 text-base"
              value={state.proposedTier}
              disabled={state.cancellationScheduled}
              onChange={(event) =>
                dispatch({ type: "selectPlan", tier: event.target.value as BillingPreviewTier })
              }
            >
              {(["free", "plus", "pro"] as const).map((tier) => (
                <option key={tier} value={tier}>
                  {label(tier)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              className={controls}
              disabled={state.proposedTier === state.tier || state.cancellationScheduled}
              onClick={() => dispatch({ type: "reviewPlan" })}
            >
              Review sample plan change
            </Button>
            {state.cancellationScheduled ? (
              <Button
                variant="outline"
                className={controls}
                onClick={() => dispatch({ type: "reviewReactivate" })}
              >
                Review sample reactivation
              </Button>
            ) : (
              <Button
                variant="outline"
                className={controls}
                disabled={state.tier === "free"}
                onClick={() => dispatch({ type: "reviewCancel" })}
              >
                Review sample cancellation
              </Button>
            )}
          </div>
        </section>
      ) : (
        <section
          aria-label="Confirm sample billing change"
          className="space-y-3 rounded-xl border p-4"
        >
          <h3 className="font-semibold">
            {state.stage === "plan_review"
              ? `Review sample change: ${label(state.tier)} to ${label(state.proposedTier)}`
              : state.stage === "cancel_review"
                ? "Review sample cancellation"
                : "Review sample reactivation"}
          </h3>
          <p className="text-sm">
            Only the local sample will change. Effective date, resulting charges or credits,
            cancellation terms and refund eligibility: owner decision required.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className={controls}
              onClick={() => dispatch({ type: "back" })}
            >
              Keep sample unchanged
            </Button>
            <Button className={controls} onClick={() => dispatch({ type: "confirm" })}>
              Confirm sample change
            </Button>
          </div>
        </section>
      )}
      <section aria-label="Sample invoices" className="space-y-2">
        <h3 className="font-semibold">Sample invoices</h3>
        <p className="text-sm text-muted-foreground">
          Illustrative records only; these are not tax invoices or proof of payment.
        </p>
        <ul className="space-y-2">
          {SAMPLE_BILLING_INVOICES.map((item) => (
            <li key={item.id}>
              <Button
                className={`${controls} w-full justify-between`}
                variant="outline"
                aria-pressed={item.id === state.invoiceId}
                onClick={() => dispatch({ type: "invoice", id: item.id })}
              >
                <span>{item.label}</span>
                <span className="text-xs">View sample</span>
              </Button>
            </li>
          ))}
        </ul>
        {invoice && (
          <section
            aria-label="Selected sample billing document"
            className="space-y-3 rounded-xl border p-4"
          >
            <h4 className="font-semibold">
              {invoice.label} · {state.document === "invoice" ? "invoice layout" : "receipt layout"}
            </h4>
            <p className="text-sm">
              {invoice.period} · {invoice.status}
            </p>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-medium">Reference</dt>
                <dd>{invoice.id}</dd>
              </div>
              <div>
                <dt className="font-medium">Amount, currency and tax</dt>
                <dd>Owner decision required; no amount has been supplied.</dd>
              </div>
              <div>
                <dt className="font-medium">Receipt validity</dt>
                <dd>
                  Sample layout only. No transaction, payment method or actual receipt is
                  represented.
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className={controls}
                onClick={() =>
                  dispatch({
                    type: "document",
                    document: state.document === "invoice" ? "receipt" : "invoice",
                  })
                }
              >
                View sample {state.document === "invoice" ? "receipt" : "invoice"}
              </Button>
              <Button
                variant="ghost"
                className={controls}
                onClick={() => dispatch({ type: "closeInvoice" })}
              >
                Close sample document
              </Button>
            </div>
          </section>
        )}
      </section>
      <Button
        variant="ghost"
        className={controls}
        onClick={() => dispatch({ type: "reset", tier: initialTier })}
      >
        Reset sample billing
      </Button>
    </div>
  );
}
