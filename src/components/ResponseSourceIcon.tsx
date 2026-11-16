import { useState, type ComponentType } from "react";
import { Globe } from "lucide-react";
import { PLUGIN_BRAND_ASSET_URLS } from "@/lib/plugin-review-catalog";

const websiteBrands = {
  "github.com": "github",
  "notion.so": "notion",
  "notion.com": "notion",
  "linear.app": "linear",
  "mail.google.com": "gmail",
  "calendar.google.com": "google-calendar",
  "drive.google.com": "google-drive",
  "outlook.live.com": "outlook",
  "outlook.office.com": "outlook",
  "onedrive.live.com": "onedrive",
  "sharepoint.com": "sharepoint",
  "teams.microsoft.com": "ms-teams",
  "slack.com": "slack",
  "salesforce.com": "salesforce",
};

export function ResponseSourceIcon({
  hostname,
  tool,
  className,
  fallback: Fallback = Globe,
}: {
  hostname?: string;
  tool?: string;
  className?: string;
  fallback?: ComponentType<{ className?: string }>;
}) {
  const [failed, setFailed] = useState<string>();
  const domain = hostname?.toLowerCase().replace(/\.$/, "");
  const brand = domain
    ? Object.entries(websiteBrands).find(
        ([host]) => domain === host || domain.endsWith(`.${host}`),
      )?.[1]
    : Object.keys(PLUGIN_BRAND_ASSET_URLS).find((id) =>
        tool
          ?.split(/[_-]/)
          .join("-")
          .match(new RegExp(`(?:^|-)${id}(?:-|$)`)),
      );
  const asset = brand ? PLUGIN_BRAND_ASSET_URLS[brand] : undefined;

  return (
    <span className={className} aria-hidden="true">
      {asset && asset !== failed ? (
        <img
          className="h-full w-full object-contain"
          src={asset}
          alt=""
          onError={() => setFailed(asset)}
        />
      ) : (
        <Fallback className="h-full w-full max-h-4 max-w-4" />
      )}
    </span>
  );
}
