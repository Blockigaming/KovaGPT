import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";
import type { Activity } from "@/lib/chat-store";
import { READ_ONLY_PLUGIN_TOOLS } from "@/lib/composer-plugin-usage.mjs";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";
import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";

export function StreamingStatus({
  activities,
  startedAt,
}: {
  activities?: Activity[];
  startedAt: number;
  onSkipThinking?: () => void;
}) {
  const elapsed = () => Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const [seconds, setSeconds] = useState(elapsed);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const active =
    activities
      ?.slice()
      .reverse()
      .find((activity) => activity.status === "running") ?? activities?.at(-1);
  const tool = active?.tool ?? "";
  const connector =
    READ_ONLY_PLUGIN_TOOLS[tool] ??
    Object.entries(CONNECTION_FLOWS).find(([, flow]) => flow.tool === tool)?.[0];
  const logo = connector ? PLUGIN_BRAND_ASSET_URLS[connector] : undefined;
  const waitStage = seconds >= 30 ? "extended" : seconds >= 8 ? "continued" : "initial";
  const label =
    connector === "github" && /search/.test(tool) && active?.status === "running"
      ? "Searching GitHub repository"
      : active?.label;
  return (
    <div
      className="kova-thinking-indicator flex min-h-8 flex-col items-start gap-1 py-1 text-sm text-muted-foreground"
      data-wait-stage={waitStage}
    >
      <span>Working for {seconds}s</span>
      <div role="status" aria-atomic="true" className="flex items-center gap-2">
        {label && (
          <>
            {logo ? (
              <img src={logo} alt="" className="size-5 rounded-full bg-white p-0.5" />
            ) : (
              <Globe2 aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span>{label}</span>
          </>
        )}
      </div>
    </div>
  );
}
