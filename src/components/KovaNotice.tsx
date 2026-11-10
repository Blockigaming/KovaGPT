import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Sparkles, TriangleAlert } from "lucide-react";

export type NoticeTone = "neutral" | "info" | "success" | "warning" | "error" | "discovery";
export type NoticeKind = "inline" | "modal";
const ICONS = {
  neutral: Info, info: Info, success: CheckCircle2,
  warning: TriangleAlert, error: AlertCircle, discovery: Sparkles,
} as const;

/** Reusable presentation only. Callers decide from verified feature state when to show a notice. */
export function KovaNotice({title, children, tone = "neutral", kind = "inline", actions}: {
  title: string;
  children: ReactNode;
  tone?: NoticeTone;
  kind?: NoticeKind;
  actions?: ReactNode;
}) {
  const Icon = ICONS[tone];
  return <section className="kova-notice" data-tone={tone} data-kind={kind}
    role={tone === "error" ? "alert" : "status"} aria-label={title}>
    <Icon data-kova-notice-icon className="h-5 w-5 shrink-0" aria-hidden="true" />
    <div data-kova-notice-copy>
      <h3 className="kova-notice-title">{title}</h3>
      <div className="kova-notice-description">{children}</div>
      {actions ? <div className="kova-notice-actions">{actions}</div> : null}
    </div>
  </section>;
}
