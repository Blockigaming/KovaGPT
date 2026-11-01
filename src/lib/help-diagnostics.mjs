import { DAILY_PLAN_ALLOWANCES } from "./plan-usage-policy.mjs";
/** Contextual paths, not a claim that every path is a separate root-cause article. */
export const HELP_ENVIRONMENTS = Object.freeze([
  {
    id: "chrome-windows",
    label: "Chrome · Windows",
    step: "In Chrome, open the site controls beside the address and review permissions for kovagpt.com. Use Ctrl+0 to restore normal zoom.",
  },
  {
    id: "edge-windows",
    label: "Edge · Windows",
    step: "In Edge, open the site controls beside the address and review permissions for kovagpt.com. Test page-altering extensions one at a time.",
  },
  {
    id: "firefox-windows",
    label: "Firefox · Windows",
    step: "In Firefox, review site permissions and Enhanced Tracking Protection for kovagpt.com. Test a new browser profile before changing the main profile.",
  },
  {
    id: "chrome-macos",
    label: "Chrome · macOS",
    step: "In Chrome, review the site controls beside the address. Use Command+0 to reset zoom; macOS microphone permissions are also controlled in System Settings.",
  },
  {
    id: "safari-macos",
    label: "Safari · macOS",
    step: "In Safari, review Website Settings for kovagpt.com. For audio, also review macOS Privacy & Security → Microphone. Keep cookies allowed for sign-in.",
  },
  {
    id: "firefox-macos",
    label: "Firefox · macOS",
    step: "In Firefox, review the site's permission panel. For audio, check both Firefox and macOS microphone permissions. A fresh profile can isolate extension issues.",
  },
  {
    id: "safari-iphone",
    label: "Safari · iPhone",
    step: "Open KovaGPT directly in Safari. Review the site's microphone and camera permissions, and use a normal tab for persistent sign-in.",
  },
  {
    id: "chrome-iphone",
    label: "Chrome · iPhone",
    step: "Open kovagpt.com directly in Chrome rather than inside another app. Review iOS Settings for Chrome's microphone and camera permissions.",
  },
  {
    id: "chrome-android",
    label: "Chrome · Android",
    step: "Open KovaGPT directly in Chrome. Use the site controls to review permissions; also check Android's app permissions for Chrome.",
  },
  {
    id: "samsung-android",
    label: "Samsung Internet · Android",
    step: "Review Samsung Internet's site permissions and Android's app permissions. Test whether content blockers are affecting KovaGPT without clearing your saved chats.",
  },
  {
    id: "safari-ipad",
    label: "Safari · iPad",
    step: "Open KovaGPT in a normal Safari tab. If a control is hidden, leave Split View temporarily and review the site's permission settings.",
  },
  {
    id: "chrome-linux",
    label: "Chrome · Linux",
    step: "Review Chrome's site permissions. For voice, also check the system's selected audio input and whether another app is using it.",
  },
]);
export const HELP_CONNECTIONS = Object.freeze([
  {
    id: "online",
    label: "Connected normally",
    step: "Try the same action once in a new chat or with a small test item. If only the original item fails, keep it and report its exact error.",
  },
  {
    id: "offline",
    label: "Offline",
    step: "Reconnect before sending, uploading, saving account changes, or creating a share link. Keep your draft open; avoid repeated submissions while offline.",
  },
  {
    id: "unstable",
    label: "Connection keeps dropping",
    step: "Keep the current tab and draft open, then retry on a stable connection. Before retrying payments or scheduled tasks, check whether the first request already completed.",
  },
  {
    id: "managed",
    label: "VPN, school, or work network",
    step: "If permitted, compare with another trusted network. Ask the network administrator whether KovaGPT's sign-in, streaming, file, or payment requests are being blocked; do not bypass workplace controls.",
  },
]);
export const HELP_STAGES = Object.freeze([
  {
    id: "first",
    label: "First attempt",
    step: "Try one small example first. Record the exact error and keep the original item until the result is confirmed.",
  },
  {
    id: "signin",
    label: "After signing in",
    step: "Check the account shown in your profile menu. Items and billing belong to that account; signing in with another address will show a different workspace.",
  },
  {
    id: "plan",
    label: "After a plan change",
    step: "Return to Settings → Billing and refresh once. Check the verified plan before retrying a paid feature; do not submit another payment while the first is pending.",
  },
  {
    id: "interrupted",
    label: "After an interrupted save",
    step: "Reopen the destination and check whether the item was saved. Keep your draft and retry only after checking for a duplicate.",
  },
  {
    id: "update",
    label: "After a browser update",
    step: "Keep unsaved drafts, then reload the page. Review site permissions if the update changed microphone, camera, pop-up, or cookie access.",
  },
  {
    id: "device",
    label: "On another device",
    step: "Confirm that both devices use the same account. Wait for the original device to finish syncing; local drafts and browser preferences may differ.",
  },
  {
    id: "moved",
    label: "After moving or deleting an item",
    step: "Look in its project, Library folder, or Chat Trash. Do not recreate or permanently delete it before checking its destination and recovery options.",
  },
  {
    id: "permissions",
    label: "After permissions changed",
    step: "Review your current project role and connection permissions. Ask the owner to restore access if needed; reconnect a service only after reviewing the requested permissions.",
  },
]);
export const HELP_PLANS = Object.freeze(["free", "plus", "pro"]);
export function diagnosticCoverage(answerCount) {
  return (
    Math.max(0, answerCount) *
    HELP_ENVIRONMENTS.length *
    HELP_CONNECTIONS.length *
    HELP_PLANS.length *
    HELP_STAGES.length
  );
}
export function contextualHelp(faq, { environment, connection, plan, stage = "first" }) {
  const device = HELP_ENVIRONMENTS.find((item) => item.id === environment);
  const network = HELP_CONNECTIONS.find((item) => item.id === connection);
  if (!device || !network || !HELP_PLANS.includes(plan) || !faq || typeof faq.answer !== "string")
    throw new Error("Choose a valid help setup.");
  const situation = HELP_STAGES.find((item) => item.id === stage);
  if (!situation) throw new Error("Choose a valid help stage.");
  const limits = DAILY_PLAN_ALLOWANCES[plan];
  const needsBrowser = /Troubleshooting|Account|Chat|Search|Files|Apps|Settings|Privacy/.test(
    faq.category,
  );
  return [
    faq.answer,
    ...(needsBrowser ? [device.step] : []),
    network.step,
    situation.step,
    /Billing|Chat|Files/.test(faq.category)
      ? `Kova ${plan === "free" ? "Free" : plan === "plus" ? "Plus" : "Pro"} includes ${limits.regularMessages.toLocaleString()} regular messages and ${limits.thinkingMessages.toLocaleString()} Thinking messages, ${limits.images} images, and ${limits.uploads} uploads per UTC day. Check Settings → Usage for your actual percentage used. Token and technical limits also apply.`
      : "Confirm that you are signed in to the account that owns the affected item.",
    "If this still fails, send Support the exact error, page, time, browser, and steps that reproduce it. Never include passwords, verification codes, API keys, or card details.",
  ];
}
