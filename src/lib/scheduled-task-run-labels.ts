const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  running: "Running",
  complete: "Completed",
  failed: "Failed",
  canceled: "Canceled",
  skipped_duplicate: "Duplicate run skipped",
};

const deliveryLabels: Record<string, string> = {
  pending: "Notification pending",
  sent: "Notification sent",
  failed: "Notification failed",
  not_configured: "Notification not configured",
};

const failureLabels: Record<string, string> = {
  temporary: "Temporary failure",
  permanent: "Permanent failure",
  authorization: "Authorization required",
  timeout: "Timed out",
};

function label(value: unknown, labels: Record<string, string>, context: string): string {
  if (value == null || value === "") return `${context} unknown`;
  const key = String(value);
  return Object.hasOwn(labels, key) ? labels[key] : `${context}: ${key}`;
}

export function taskRunStatusLabel(value: unknown): string {
  return label(value, statusLabels, "Run status");
}

export function taskRunDeliveryLabel(value: unknown): string {
  return label(value, deliveryLabels, "Notification status");
}

export function taskRunFailureLabel(value: unknown, retryEligible: unknown): string {
  const failure = label(value, failureLabels, "Failure type");
  // Eligibility is not evidence that a retry has been scheduled or completed.
  return retryEligible ? `${failure} · Eligible for retry` : failure;
}
