// Pure server-side account notification rendering. This module never sends mail.
// Keep the existing KovaGPT palette/font fallbacks without remote assets or tracking.
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const EVENTS = {
  password_changed: {
    subject: "Your KovaGPT password changed",
    heading: "Your password changed",
    introduction: "The password for your KovaGPT account was changed.",
    help: "If this was not you, reset your password and review your active sessions in Settings → Security.",
    action: "Review account security",
    path: "/auth",
  },
  security_method_added: {
    subject: "A security method was added to your KovaGPT account",
    heading: "Security method added",
    introduction: "A sign-in or verification method was added to your KovaGPT account.",
    help: "If this was not you, review your security methods and active sessions in Settings → Security.",
    action: "Review account security",
    path: "/auth",
  },
  security_method_changed: {
    subject: "A security method changed on your KovaGPT account",
    heading: "Security method changed",
    introduction: "A sign-in or verification method on your KovaGPT account was updated.",
    help: "If this was not you, review your security methods and active sessions in Settings → Security.",
    action: "Review account security",
    path: "/auth",
  },
  security_method_removed: {
    subject: "A security method was removed from your KovaGPT account",
    heading: "Security method removed",
    introduction: "A sign-in or verification method was removed from your KovaGPT account.",
    help: "If this was not you, review your security methods and active sessions in Settings → Security.",
    action: "Review account security",
    path: "/auth",
  },
  account_deletion_scheduled: {
    subject: "Your KovaGPT account is scheduled for deletion",
    heading: "Account deletion scheduled",
    introduction:
      "Your KovaGPT account is scheduled for deletion after the 30-day recovery period.",
    help: "You can recover your account before the deadline in Settings → Data controls. Scheduling deletion does not cancel billing; manage subscriptions separately in Billing. If you did not request this, review your account now.",
    action: "Review your account",
    path: "/auth",
  },
  account_deleted: {
    subject: "Your KovaGPT account has been deleted",
    heading: "Your account was deleted",
    introduction: "Your KovaGPT account has been deleted.",
    help: "Records we must retain for legal or security obligations may remain under our retention policy. If you did not request this, contact support@kovagpt.com.",
    action: "Open KovaGPT",
    path: "/",
  },
  new_login: {
    subject: "A new sign-in to your KovaGPT account",
    heading: "New sign-in",
    introduction: "A new session was started for your KovaGPT account.",
    help: "If this was not you, review your active sessions and change your password in Settings → Security.",
    action: "Review account security",
    path: "/auth",
  },
  email_changed: {
    subject: "Your KovaGPT email address changed",
    heading: "Email address changed",
    introduction: "The email address on your KovaGPT account was changed.",
    help: "If this was not you, review your account security and contact support@kovagpt.com.",
    action: "Review account security",
    path: "/auth",
  },
  account_recovered: {
    subject: "Your KovaGPT account was recovered",
    heading: "Your account was recovered",
    introduction: "The scheduled deletion of your KovaGPT account was cancelled.",
    help: "If this was not you, review your active sessions and security methods in Settings → Security.",
    action: "Review your account",
    path: "/auth",
  },
  welcome: {
    subject: "Welcome to KovaGPT",
    heading: "Welcome to KovaGPT",
    introduction: "Your KovaGPT account is ready. You can start a conversation whenever you like.",
    help: "You control optional account emails in Settings → Notifications.",
    action: "Open KovaGPT",
    path: "/",
  },
};

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

function exactHttpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("account_email_origin_invalid");
  }
  if (
    typeof value !== "string" ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.origin !== value
  ) {
    throw new Error("account_email_origin_invalid");
  }
  return value;
}

function timestamp(value) {
  const parts =
    typeof value === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(
          value,
        )
      : null;
  if (!parts) {
    throw new Error("account_email_timestamp_invalid");
  }
  const date = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00.000Z`);
  const time = Date.parse(value);
  // Date.parse normalizes impossible dates such as February 30 and 24:00.
  // Reject those instead of silently attaching a different date to a security notice.
  if (
    !Number.isFinite(time) ||
    date.getUTCFullYear() !== Number(parts[1]) ||
    date.getUTCMonth() + 1 !== Number(parts[2]) ||
    date.getUTCDate() !== Number(parts[3]) ||
    Number(parts[4]) > 23 ||
    Number(parts[5]) > 59 ||
    Number(parts[6]) > 59
  )
    throw new Error("account_email_timestamp_invalid");
  return {
    time,
    text: new Date(time)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/u, " UTC"),
  };
}

/** Fixed account-event copy only: never accepts arbitrary HTML, URLs, or secrets. */
export function renderKovaAccountEmail(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("account_email_input_invalid");
  const { event, publicOrigin, occurredAt, deletionScheduledFor } = input;
  const content = typeof event === "string" && Object.hasOwn(EVENTS, event) ? EVENTS[event] : null;
  if (!content) throw new Error("account_email_event_unsupported");
  const origin = exactHttpsOrigin(publicOrigin);
  const occurred = timestamp(occurredAt);
  let deadline;
  if (event === "account_deletion_scheduled") {
    deadline = timestamp(deletionScheduledFor);
    if (deadline.time <= occurred.time) throw new Error("account_email_deletion_deadline_invalid");
  } else if (deletionScheduledFor !== undefined) {
    throw new Error("account_email_deletion_deadline_unexpected");
  }
  // All destinations come from this fixed catalog and existing application routes.
  const actionUrl = `${origin}${content.path}`;
  const privacyUrl = `${origin}/privacy`;
  const preferenceCopy =
    event === "account_deleted"
      ? "This notice confirms completed account deletion."
      : "Manage account email preferences in Settings → Notifications.";
  const details = [
    `Time: ${occurred.text}`,
    ...(deadline ? [`Recovery deadline: ${deadline.text}`] : []),
  ];
  const text = [
    "KovaGPT",
    content.heading,
    content.introduction,
    ...details,
    content.help,
    `${content.action}: ${actionUrl}`,
    preferenceCopy,
    "KovaGPT will never ask you to reply with your password, verification code, or recovery code.",
    "Need help? Contact support@kovagpt.com.",
    `Privacy: ${privacyUrl}`,
  ].join("\n\n");
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(content.subject)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
.kova-page, .kova-container { background: #ffffff; color: #202123; }
.kova-muted { color: #5f6368; }
.kova-detail { background: #f7f7f8; border-color: #e5e5e5; }
.kova-link { color: #2563eb; }
.kova-button { background: #202123; color: #ffffff !important; }
@media (prefers-color-scheme: dark) {
  .kova-page, .kova-container { background: #212121 !important; color: #ececec !important; }
  .kova-text, .kova-brand, .kova-heading { color: #ececec !important; }
  .kova-muted { color: #b4b4b4 !important; }
  .kova-detail { background: #2f2f2f !important; border-color: #424242 !important; }
  .kova-link { color: #8ab4f8 !important; }
  .kova-button { background: #ececec !important; color: #171717 !important; }
  .kova-divider { border-color: #424242 !important; }
}
[data-ogsc] .kova-page, [data-ogsc] .kova-container { background: #212121 !important; color: #ececec !important; }
[data-ogsc] .kova-text, [data-ogsc] .kova-brand, [data-ogsc] .kova-heading { color: #ececec !important; }
[data-ogsc] .kova-muted { color: #b4b4b4 !important; }
[data-ogsc] .kova-detail { background: #2f2f2f !important; border-color: #424242 !important; }
[data-ogsc] .kova-link { color: #8ab4f8 !important; }
[data-ogsc] .kova-button { background: #ececec !important; color: #171717 !important; }
[data-ogsc] .kova-divider { border-color: #424242 !important; }
@media only screen and (max-width: 620px) { .kova-container { padding: 28px 22px !important; } .kova-heading { font-size: 25px !important; } }
</style></head>
<body class="kova-page" style="margin:0;padding:24px 0;background-color:#ffffff;color:#202123;font-family:${escapeHtml(FONT)};font-size:15px;line-height:1.6;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.introduction)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:560px;table-layout:fixed;"><tr><td class="kova-container" style="padding:36px 32px 40px;background-color:#ffffff;color:#202123;word-wrap:break-word;overflow-wrap:anywhere;">
<p class="kova-brand" style="font-size:18px;font-weight:600;letter-spacing:-.02em;margin:0 0 36px;">KovaGPT</p>
<p class="kova-muted" style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;">Account update</p>
<h1 class="kova-heading" style="font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-.025em;margin:0 0 20px;">${escapeHtml(content.heading)}</h1>
<p class="kova-text" style="margin:0 0 24px;">${escapeHtml(content.introduction)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 24px;"><tr><td class="kova-detail" style="padding:16px 18px;border:1px solid #e5e5e5;border-radius:12px;background-color:#f7f7f8;">
${details.map((detail) => `<p class="kova-text" style="font-size:13px;margin:4px 0;">${escapeHtml(detail)}</p>`).join("\n")}
</td></tr></table>
<p class="kova-text" style="margin:0 0 22px;">${escapeHtml(content.help)}</p>
<p style="margin:26px 0 28px;"><a class="kova-button" href="${escapeHtml(actionUrl)}" style="display:inline-block;min-height:20px;padding:14px 22px;border-radius:10px;background-color:#202123;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(content.action)}</a></p>
<p class="kova-muted" style="font-size:12px;margin:0 0 18px;">${escapeHtml(preferenceCopy)}</p>
<div class="kova-divider" style="margin-top:32px;padding-top:22px;border-top:1px solid #e5e5e5;">
<p class="kova-muted" style="font-size:12px;margin:0 0 12px;">KovaGPT will never ask you to reply with your password, verification code, or recovery code.</p>
<p class="kova-muted" style="font-size:12px;margin:0;"><a class="kova-link" href="mailto:support@kovagpt.com" style="color:#2563eb;">Support</a> &nbsp;·&nbsp; <a class="kova-link" href="${escapeHtml(privacyUrl)}" style="color:#2563eb;">Privacy</a></p>
</div></td></tr></table></td></tr></table></body></html>`;
  return { subject: content.subject, html, text };
}
