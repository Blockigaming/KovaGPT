// Fixed server-owned presentation for newly rendered messages. The exact HTML
// is queued before dispatch, preserving provider idempotency across deployments.
const PRESENTATION = `
.kova-page { background-color: #f4f4f2 !important; padding: 32px 12px !important; }
.kova-container { border: 1px solid #e5e5e3; border-radius: 24px; padding: 40px !important; }
.kova-brand { font-size: 18px !important; font-weight: 650 !important; letter-spacing: -.035em; margin-bottom: 32px !important; }
.kova-heading { font-size: 30px !important; line-height: 1.15 !important; font-weight: 650 !important; letter-spacing: -.035em; }
.kova-text { font-size: 15px; line-height: 1.7; }
.kova-button { border-radius: 999px !important; min-height: 20px; padding: 14px 24px !important; font-size: 14px !important; line-height: 20px !important; }
.kova-detail { border-radius: 16px !important; }
.kova-divider { margin-top: 32px; padding-top: 24px; }
@media (prefers-color-scheme: dark) {
  .kova-page { background-color: #141414 !important; }
  .kova-container { background-color: #212121 !important; border-color: #393939 !important; }
}
[data-ogsc] .kova-page { background-color: #141414 !important; }
[data-ogsc] .kova-container { background-color: #212121 !important; border-color: #393939 !important; }
@media only screen and (max-width: 620px) {
  .kova-page { padding: 16px 8px !important; }
  .kova-container { padding: 28px 22px !important; border-radius: 20px; }
  .kova-heading { font-size: 26px !important; }
}
`;

// Preserve the earlier queued presentation verbatim. A provider acceptance can
// outlive a deploy, so the dispatcher must still recognize its exact bytes.
export function presentPreviousKovaEmailHtml(html) {
  if (typeof html !== "string" || !html.includes("</style>")) {
    throw new Error("email_presentation_invalid");
  }
  return html.replace("</style>", `${PRESENTATION}</style>`);
}

// Embedded CSS is stripped by some clients. Put the main visual hierarchy in
// inline styles as well; media queries continue to adapt clients that support
// them. Only server-owned tags/classes are changed, exactly once each.
const INLINE = [
  ["body", "kova-page", "background-color:#f4f4f2;padding:32px 12px;"],
  ["td", "kova-container", "border:1px solid #e5e5e3;border-radius:24px;padding:40px;"],
  ["p", "kova-brand", "font-size:18px;font-weight:600;letter-spacing:-.035em;margin-bottom:32px;"],
  ["h1", "kova-heading", "font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.035em;"],
  [
    "a",
    "kova-button",
    "border-radius:999px;min-height:20px;padding:14px 24px;font-size:14px;line-height:20px;",
  ],
];

export function presentKovaEmailHtml(html) {
  let rendered = presentPreviousKovaEmailHtml(html);
  for (const [tag, className, style] of INLINE) {
    const expression = new RegExp(
      `(<${tag}\\b[^>]*\\bclass="${className}"[^>]*\\bstyle=")([^"]*)(")`,
      "gu",
    );
    let count = 0;
    rendered = rendered.replace(expression, (_match, before, existing, after) => {
      count += 1;
      return `${before}${existing};${style}${after}`;
    });
    if (count !== 1) throw new Error("email_presentation_invalid");
  }
  return rendered;
}
