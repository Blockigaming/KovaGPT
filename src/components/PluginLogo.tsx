import { useState } from "react";
import { Puzzle } from "lucide-react";
import { LAUNCH_PLUGIN_IDS } from "@/lib/core-launch-policy.mjs";
import { cn } from "@/lib/utils";
/** Bundled official marks: no third-party favicon request or provider tracking. */
export function PluginLogo({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5",
        className,
      )}
    >
      {LAUNCH_PLUGIN_IDS.includes(id) && !failed ? (
        <img
          src={`/plugin-logos/${id}.webp`}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Puzzle aria-label={label} className="h-5 w-5 text-black" />
      )}
    </span>
  );
}
