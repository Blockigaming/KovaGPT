import { AlertTriangle, CircleAlert, RefreshCw } from "lucide-react";
import type { ClientCapabilityState } from "@/lib/readiness-client";
import { Button } from "@/components/ui/button";

const copy: Partial<Record<ClientCapabilityState, [string, string]>> = {
  unavailable: ["Temporarily unavailable", "This capability is not available right now."],
  degraded: ["Limited availability", "This capability may respond more slowly than usual."],
  "migration-required": [
    "Update in progress",
    "This workspace is temporarily unavailable while its data update is applied.",
  ],
  "schema-drift": [
    "Maintenance required",
    "This workspace is paused until its data contract is restored.",
  ],
  "provider-timeout": [
    "Provider timed out",
    "The provider did not respond in time. Your work was not submitted.",
  ],
  "plan-required": ["Plan required", "This capability is not included in the current plan."],
  "quota-exhausted": ["Usage limit reached", "The current usage allowance has been reached."],
  "authentication-required": ["Sign in required", "Sign in to use this account-backed capability."],
  "reconnect-required": ["Reconnect required", "Reconnect the integration before continuing."],
  "billing-verification-pending": [
    "Verifying billing",
    "Access will update after the verified billing event arrives.",
  ],
  "runner-unavailable": [
    "Agent runner unavailable",
    "Agent execution is paused. Definitions remain available.",
  ],
  "hosted-execution-unavailable": [
    "Hosted execution unavailable",
    "Tasks can be edited, but cannot be enabled right now.",
  ],
  "storage-unavailable": [
    "Storage unavailable",
    "Uploads are paused. Existing local work is unaffected.",
  ],
};

export function OperationalState({
  state,
  title,
  description,
  correlationId,
  onRetry,
}: {
  state: ClientCapabilityState;
  title?: string;
  description?: string;
  correlationId?: string;
  onRetry?: () => void;
}) {
  if (state === "ready" || state === "loading") return null;
  const defaults = copy[state] ?? [
    "Capability unavailable",
    "Try again later or continue with another workspace.",
  ];
  const retryable =
    onRetry && ["degraded", "unavailable", "provider-timeout", "database-timeout"].includes(state);
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-muted/40 p-4 text-sm"
    >
      <div className="flex items-start gap-3">
        {state === "degraded" ? (
          <AlertTriangle className="mt-0.5 size-5" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 size-5" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title ?? defaults[0]}</p>
          <p className="mt-1 text-muted-foreground">{description ?? defaults[1]}</p>
          {correlationId && (
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Reference: {correlationId}
            </p>
          )}
          {retryable && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
