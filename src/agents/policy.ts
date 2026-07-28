export const CONSEQUENTIAL_ACTIONS = [
  "purchase",
  "transfer_money",
  "trade",
  "send_message",
  "send_email",
  "delete",
  "publish",
  "change_permission",
  "accept_terms",
  "submit_medical_information",
  "book_appointment",
  "cancel_appointment",
  "create_account",
  "change_authentication",
] as const;
export type ConsequentialAction = (typeof CONSEQUENTIAL_ACTIONS)[number];
export type BrowserAction =
  | { type: "goto"; url: string }
  | { type: "click"; selector: string; consequentialAction?: ConsequentialAction }
  | { type: "fill"; selector: string; value: string; sensitive?: boolean }
  | { type: "scroll"; y: number }
  | { type: "wait"; milliseconds: number }
  | { type: "extract"; selector: string }
  | { type: "screenshot"; label: string };
export type BrowserPolicy = {
  allowedDomains: string[];
  blockedDomains: string[];
  maxActions: number;
  maxRuntimeMs: number;
  allowUploads: boolean;
  allowDownloads: boolean;
};

export function validateBrowserAction(action: BrowserAction, policy: BrowserPolicy) {
  if (action.type === "goto") {
    const url = new URL(action.url);
    if (url.protocol !== "https:")
      return { allowed: false, reason: "https_required", approval: false };
    const host = url.hostname.toLowerCase();
    if (policy.blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`)))
      return { allowed: false, reason: "domain_blocked", approval: false };
    if (
      policy.allowedDomains.length &&
      !policy.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
      return { allowed: false, reason: "domain_not_allowed", approval: false };
  }
  if (action.type === "fill" && action.sensitive)
    return { allowed: false, reason: "raw_secret_entry_prohibited", approval: false };
  if (action.type === "click" && action.consequentialAction)
    return { allowed: true, reason: "explicit_approval_required", approval: true };
  if (action.type === "wait" && (action.milliseconds < 0 || action.milliseconds > 30_000))
    return { allowed: false, reason: "wait_out_of_bounds", approval: false };
  return { allowed: true, approval: false };
}
