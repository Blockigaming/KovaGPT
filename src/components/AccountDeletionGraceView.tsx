import { useRef, type ComponentPropsWithoutRef } from "react";
import { CalendarClock, CircleCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  canRecoverAccountDeletion,
  formatAccountDeletionDate,
} from "@/lib/account-deletion-grace.mjs";
import "./account-deletion-grace.css";

export type AccountDeletionGraceStatus =
  | "unavailable"
  | "confirm"
  | "scheduled"
  | "schedule-failed"
  | "recovery-failed"
  | "recovered"
  | "unknown"
  | "expired"
  | "deleting"
  | "deleted";

export interface AccountDeletionSchedule {
  requestedAt: string;
  effectiveAt: string;
  timeZone: string;
  overdue: boolean;
}

export interface AccountDeletionGraceViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ComponentPropsWithoutRef<typeof DialogContent>["onCloseAutoFocus"];
  status: AccountDeletionGraceStatus;
  schedule?: AccountDeletionSchedule;
  reviewLabel?: string;
  onSchedule?: () => void;
  onRecover?: () => void;
  onCheckStatus?: () => void;
}

/**
 * Pure presentation boundary: no account, request, storage, timer, or provider
 * access. Production supplies only unavailable. A separately bundled private
 * review controller supplies synthetic states and local-only callbacks.
 */
export function AccountDeletionGraceView({
  open,
  onOpenChange,
  onCloseAutoFocus,
  status,
  schedule,
  reviewLabel,
  onSchedule,
  onRecover,
  onCheckStatus,
}: AccountDeletionGraceViewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const expired =
    status === "expired" ||
    ((status === "scheduled" || status === "recovery-failed") && Boolean(schedule?.overdue));
  const recoverable = canRecoverAccountDeletion(status, expired);
  const confirming = status === "confirm" || status === "schedule-failed";
  const failed = !expired && (status === "schedule-failed" || status === "recovery-failed");
  const title =
    status === "unavailable"
      ? "Account deletion is unavailable"
      : expired
        ? "Recovery window expired"
        : confirming
          ? "Schedule account deletion?"
          : recoverable
            ? "Account deletion scheduled"
            : status === "recovered"
              ? "Account recovered"
              : status === "deleting"
                ? "Account deletion has started"
                : status === "deleted"
                  ? "Account deleted"
                  : "Deletion status is unknown";
  const description =
    status === "unavailable"
      ? "Scheduling account deletion and recovering an account are not available here yet. No deletion request can be submitted from this screen."
      : expired
        ? "The 30-day recovery window has ended. Deletion may be pending, but its actual status is unknown. Recovery is not available from this screen."
        : confirming
          ? "Schedule deletion with a 30-day recovery period. You can cancel deletion and recover your account within that period, before irreversible deletion begins."
          : recoverable
            ? "You can still recover your account and cancel this deletion request. Irreversible deletion has not started."
            : status === "recovered"
              ? "The deletion request was canceled. Your account is active again."
              : status === "deleting"
                ? "Irreversible deletion has started. This is not a recoverable grace-period state, and completed cleanup cannot be undone."
                : status === "deleted"
                  ? "Deletion is complete. This account cannot be recovered."
                  : "We cannot confirm whether a deletion request is scheduled or whether irreversible deletion has started. No recovery or deletion outcome is confirmed.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="kova-account-deletion-dialog"
        data-account-deletion-state={status}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <span className="kova-account-deletion-icon" aria-hidden="true">
            {status === "recovered" ? (
              <CircleCheck />
            ) : recoverable ? (
              <ShieldCheck />
            ) : (
              <CalendarClock />
            )}
          </span>
          {reviewLabel && <p className="kova-account-deletion-review">{reviewLabel}</p>}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {(confirming || recoverable || status === "unavailable") && (
          <section className="kova-account-deletion-panel" aria-label="Recovery period">
            <h2 className="text-sm font-semibold">30-day recovery period</h2>
            <p>
              The grace period is 30 × 24 hours from the accepted request. Recover your account
              before the period ends to cancel deletion. Reaching the scheduled time does not by
              itself confirm that irreversible deletion has started or finished.
            </p>
            {status === "unavailable" && (
              <p>
                This recovery policy is not enabled here. This screen cannot verify your current
                deletion status.
              </p>
            )}
          </section>
        )}

        {(recoverable || expired) && schedule && (
          <section className="kova-account-deletion-panel" aria-label="Deletion schedule">
            <dl className="kova-account-deletion-dates">
              <div>
                <dt>Requested</dt>
                <dd>
                  <time dateTime={schedule.requestedAt}>
                    {formatAccountDeletionDate(schedule.requestedAt, schedule.timeZone)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Recovery deadline · deletion eligible from</dt>
                <dd>
                  <time dateTime={schedule.effectiveAt}>
                    {formatAccountDeletionDate(schedule.effectiveAt, schedule.timeZone)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Time zone</dt>
                <dd>{schedule.timeZone}</dd>
              </div>
            </dl>
            {schedule.overdue && (
              <p role="status">
                The recovery deadline has passed. Actual deletion status is unknown; the time alone
                does not confirm that your account has been deleted.
              </p>
            )}
          </section>
        )}

        {confirming && (
          <p className="kova-account-deletion-detail">
            Once irreversible deletion starts, your sign-in account and associated cloud data are
            removed, stored credentials are disconnected, and active subscriptions are canceled.
            Legally required billing, security, and backup records may be retained.
          </p>
        )}
        {failed && (
          <p role="alert" className="kova-account-deletion-error">
            <TriangleAlert aria-hidden="true" />
            {status === "schedule-failed"
              ? "The deletion request was not accepted. Nothing was scheduled. You can try again or cancel."
              : "Recovery was not completed. The deletion request is still scheduled. Try recovering again within the 30-day period."}
          </p>
        )}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {status === "recovered"
            ? "Deletion canceled successfully. Your account is active."
            : status === "scheduled" && !expired
              ? "Deletion request scheduled. Recovery is available during the 30-day period."
              : ""}
        </p>
        {recoverable && (
          <p className="kova-account-deletion-detail">
            Recover account cancels the scheduled deletion. Closing this dialog does not cancel it.
          </p>
        )}

        <DialogFooter>
          <Button
            ref={closeRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {confirming ? "Cancel" : status === "recovered" ? "Done" : "Close"}
          </Button>
          {status === "unavailable" && (
            <Button type="button" disabled>
              Scheduling unavailable
            </Button>
          )}
          {confirming && (
            <Button type="button" variant="destructive" onClick={onSchedule} disabled={!onSchedule}>
              Schedule deletion
            </Button>
          )}
          {recoverable && (
            <Button type="button" onClick={onRecover} disabled={!onRecover}>
              Recover account
            </Button>
          )}
          {status === "unknown" && onCheckStatus && (
            <Button type="button" onClick={onCheckStatus}>
              Check status
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
