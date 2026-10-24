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

export function presentKovaEmailHtml(html) {
  if (typeof html !== "string" || !html.includes("</style>")) {
    throw new Error("email_presentation_invalid");
  }
  return html.replace("</style>", `${PRESENTATION}</style>`);
}
