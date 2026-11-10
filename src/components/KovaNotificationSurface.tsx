import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { notificationDefinition } from "@/lib/notification-catalog.mjs";
import "./kova-notification-surface.css";

export type KovaNotice = {
  id: string;
  title: string;
  message?: string;
  confirmed?: boolean;
  key?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};
/** Dispatch only after the related action has actually succeeded. */
export function publishKovaNotice(notice: KovaNotice) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kova:notice", { detail: notice }));
  }
}
export function KovaNotificationSurface() {
  const [active, setActive] = useState<KovaNotice | null>(null);
  useEffect(() => {
    const handle = (event: Event) => {
      const notice = (event as CustomEvent<KovaNotice>).detail;
      if (!notice || typeof notice.title !== "string" || notice.title.length > 160) return;
      const definition = notificationDefinition(notice.id);
      if (!definition || (definition.requiresEvidence && notice.confirmed !== true)) return;
      if (definition.surface === "toast" || definition.surface === "status" || definition.surface === "inline") {
        toast(notice.title, {
          id: notice.key ?? notice.id,
          description: notice.message,
          duration: definition.surface === "status" ? 5000 : definition.surface === "inline" ? 7500 : 3000,
          action: notice.onPrimary && notice.primaryLabel
            ? { label: notice.primaryLabel, onClick: notice.onPrimary } : undefined,
        });
      } else {
        setActive((previous) => previous ?? notice);
      }
    };
    window.addEventListener("kova:notice", handle);
    return () => window.removeEventListener("kova:notice", handle);
  }, []);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && notificationDefinition(active.id)?.dismissible) {
        event.preventDefault();
        setActive(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
  if (!active) return null;
  const definition = notificationDefinition(active.id);
  if (!definition) return null;
  return (
    <div className="kova-notice-backdrop" role="presentation">
      <section
        className="kova-notice-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kova-notice-title"
        aria-describedby={active.message ? "kova-notice-body" : undefined}
        data-surface={definition.surface}
      >
        {definition.dismissible && (
          <button className="kova-notice-close" type="button" aria-label="Close notification"
            onClick={() => setActive(null)}><X size={19} /></button>
        )}
        <h2 id="kova-notice-title">{active.title}</h2>
        {active.message && <p id="kova-notice-body">{active.message}</p>}
        <div className="kova-notice-actions">
          {active.onPrimary && active.primaryLabel && (
            <button className="kova-notice-primary" type="button" onClick={() => {
              active.onPrimary?.(); setActive(null);
            }}>{active.primaryLabel}</button>
          )}
          {definition.dismissible && (
            <button className="kova-notice-secondary" type="button" onClick={() => {
              active.onSecondary?.(); setActive(null);
            }}>{active.secondaryLabel || "Not now"}</button>
          )}
        </div>
      </section>
    </div>
  );
}
