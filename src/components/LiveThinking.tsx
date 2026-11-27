import { useEffect, useState } from "react";
import type { Activity } from "@/lib/chat-store";
import { MessageActivityList } from "./MessageActivityList";
import { t } from "@/lib/localization";

/**
 * Shown while a reply is being made: a live "Thinking · 12s" timer and, as the server reports
 * them, the steps the reply is working through. Once the reply finishes it gives way to the
 * "Worked for" line and the completed activity list.
 */
export function LiveThinking({
  startedAt,
  activities,
}: {
  startedAt?: number;
  activities?: Activity[];
}) {
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const steps = activities?.length ?? 0;
  return (
    <details className="kova-live-thinking">
      <summary>
        <span className="kova-live-thinking-dot" aria-hidden="true" />
        <span>{t("Thinking")}</span>
        <span className="kova-live-thinking-time" aria-hidden="true">
          {seconds}s
        </span>
        {steps > 0 && <span className="kova-live-thinking-count">· {steps}</span>}
      </summary>
      {steps > 0 && <MessageActivityList activities={activities} />}
    </details>
  );
}
