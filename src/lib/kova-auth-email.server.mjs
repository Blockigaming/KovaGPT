// Server-side rendering only. This module sends no email and changes no provider.
// Palette/font fallbacks are based on email-templates/_brand.tsx at da4b02ea554b16862b70b311854761554bafb765.
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const ACTIONS = {
  "kova-auth-verification": {
    subject: "Verify your KovaGPT email",
    action: "Verify email",
    introduction: "Confirm this email address to finish setting up your KovaGPT account.",
    ignored: "If you did not request this, you can ignore this email.",
    path: "/api/auth/verify",
  },
  "kova-auth-recovery": {
    subject: "Reset your KovaGPT password",
    action: "Reset password",
    introduction:
      "We received a request to reset your KovaGPT password. Use the link below to choose a new one.",
    ignored:
      "If you did not request a password reset, you can ignore this email. Your password will stay the same.",
    path: "/reset-password",
  },
};

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function exactHttpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("auth_email_origin_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value) {
    throw new Error("auth_email_origin_invalid");
  }
  return url.origin;
}

function safeActionLink(value, origin, action) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("auth_email_link_invalid");
  }
  if (
    url.origin !== origin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== action.path ||
    url.toString() !== value
  ) {
    throw new Error("auth_email_link_invalid");
  }
  const verification = action.path === "/api/auth/verify";
  const params = verification ? url.searchParams : new URLSearchParams(url.hash.slice(1));
  if (
    (verification && url.hash) ||
    (!verification && url.search) ||
    [...params.keys()].join() !== "token" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(params.get("token") ?? "")
  ) {
    throw new Error("auth_email_link_invalid");
  }
  return value;
}

function expiryCopy(issuedAt, expiresAt) {
  // Both values are supplied by the caller that creates the database challenge.
  // Render the exact same expiry rather than starting a new clock at delivery.
  const issued = new Date(issuedAt);
  const expires = new Date(expiresAt);
  if (
    typeof issuedAt !== "string" ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(issued.getTime()) ||
    !Number.isFinite(expires.getTime()) ||
    expires.getTime() <= issued.getTime()
  ) {
    throw new Error("auth_email_expiry_invalid");
  }
  const lifetimeSeconds = (expires.getTime() - issued.getTime()) / 1000;
  const duration =
    lifetimeSeconds === 3600
      ? "1 hour after it was requested"
      : lifetimeSeconds % 60 === 0
        ? `${lifetimeSeconds / 60} minutes after it was requested`
        : `${lifetimeSeconds} seconds after it was requested`;
  const absolute = expires
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  return `This link expires ${duration}, at ${absolute}. If it has expired, request a new link from KovaGPT.`;
}

/** Pure renderer for the two action types the owned Auth service currently queues. */
export function renderKovaAuthEmail({ label, recipient, link, publicOrigin, issuedAt, expiresAt }) {
  const action = Object.hasOwn(ACTIONS, label) ? ACTIONS[label] : null;
  if (!action) throw new Error("auth_email_action_unsupported");
  if (
    typeof recipient !== "string" ||
    !recipient ||
    recipient.length > 320 ||
    /[\u0000-\u001f\u007f]/.test(recipient)
  ) {
    throw new Error("auth_email_recipient_invalid");
  }
  const origin = exactHttpsOrigin(publicOrigin);
  const safeLink = safeActionLink(link, origin, action);
  const expiry = expiryCopy(issuedAt, expiresAt);
  const recipientHtml = escapeHtml(recipient);
  const href = escapeHtml(safeLink);
  const support = "mailto:support@kovagpt.com";
  const text = [
    "KovaGPT",
    action.subject,
    action.introduction,
    `Email: ${recipient}`,
    `${action.action}: ${safeLink}`,
    expiry,
    "This link can be used once. Do not forward this email or share its link.",
    action.ignored,
    "KovaGPT will never ask you to reply with your password or verification code.",
    "Need help? Contact support@kovagpt.com.",
  ].join("\n\n");
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${action.subject}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
.kova-page, .kova-container { background: #ffffff; color: #202123; }
.kova-muted { color: #5f6368; }
.kova-link { color: #2563eb; }
.kova-button { background: #202123; color: #ffffff !important; }
@media (prefers-color-scheme: dark) {
  .kova-page, .kova-container { background: #212121 !important; color: #ececec !important; }
  .kova-text, .kova-brand, .kova-heading { color: #ececec !important; }
  .kova-muted { color: #b4b4b4 !important; }
  .kova-link { color: #8ab4f8 !important; }
  .kova-button { background: #ececec !important; color: #171717 !important; }
  .kova-divider { border-color: #424242 !important; }
}
[data-ogsc] .kova-page, [data-ogsc] .kova-container { background: #212121 !important; color: #ececec !important; }
[data-ogsc] .kova-text, [data-ogsc] .kova-brand, [data-ogsc] .kova-heading { color: #ececec !important; }
[data-ogsc] .kova-muted { color: #b4b4b4 !important; }
[data-ogsc] .kova-link { color: #8ab4f8 !important; }
[data-ogsc] .kova-button { background: #ececec !important; color: #171717 !important; }
[data-ogsc] .kova-divider { border-color: #424242 !important; }
@media only screen and (max-width: 620px) { .kova-container { padding: 28px 22px !important; } }
</style></head>
<body class="kova-page" style="margin:0;background-color:#ffffff;color:#202123;font-family:${escapeHtml(FONT)};font-size:16px;line-height:1.6;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${action.subject}. ${escapeHtml(expiry)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:560px;table-layout:fixed;"><tr><td class="kova-container" style="padding:36px 32px 40px;background-color:#ffffff;color:#202123;word-wrap:break-word;overflow-wrap:anywhere;">
<p class="kova-brand" style="font-size:18px;font-weight:600;margin:0 0 32px;">KovaGPT</p>
<h1 class="kova-heading" style="font-size:24px;line-height:1.25;margin:0 0 18px;">${action.subject}</h1>
<p class="kova-text" style="margin:0 0 18px;">${action.introduction}</p>
<p class="kova-text" style="margin:0 0 18px;overflow-wrap:anywhere;word-break:break-all;">Email: <span dir="ltr">${recipientHtml}</span></p>
<p style="margin:26px 0 22px;"><a class="kova-button" href="${href}" style="display:inline-block;min-height:24px;padding:12px 22px;border-radius:6px;background-color:#202123;color:#ffffff;text-decoration:none;font-weight:600;">${action.action}</a></p>
<p class="kova-text" style="margin:0 0 18px;">${escapeHtml(expiry)}</p>
<p class="kova-text" style="margin:0 0 18px;">This link can be used once. Do not forward this email or share its link.</p>
<p class="kova-text" style="margin:0 0 18px;">${action.ignored}</p>
<p class="kova-muted" style="font-size:14px;margin:0 0 6px;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 18px;overflow-wrap:anywhere;word-break:break-all;"><a class="kova-link" href="${href}" style="color:#2563eb;font-size:14px;word-break:break-all;">${href}</a></p>
<div class="kova-divider" style="margin-top:32px;padding-top:22px;border-top:1px solid #e5e5e5;">
<p class="kova-muted" style="font-size:13px;margin:0 0 10px;">KovaGPT will never ask you to reply with your password or verification code.</p>
<p class="kova-muted" style="font-size:13px;margin:0;">Need help? <a class="kova-link" href="${support}" style="color:#2563eb;">Contact KovaGPT support</a>.</p>
</div></td></tr></table></td></tr></table></body></html>`;
  return { subject: action.subject, html, text };
}
