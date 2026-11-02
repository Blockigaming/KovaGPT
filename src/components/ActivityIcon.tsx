import { useState } from "react";
import { Globe } from "lucide-react";
import { activityHostname } from "@/lib/activity-display.mjs";
import github from "@/assets/plugins/github.svg";
import gmail from "@/assets/plugins/gmail.svg";
import drive from "@/assets/plugins/google-drive.svg";
import calendar from "@/assets/plugins/google-calendar.svg";
import notion from "@/assets/plugins/notion.svg";
import slack from "@/assets/plugins/slack.svg";
import linear from "@/assets/plugins/linear.svg";
import outlook from "@/assets/plugins/outlook.svg";
const logos: Record<string, string> = {
  "github.com": github,
  "mail.google.com": gmail,
  "drive.google.com": drive,
  "calendar.google.com": calendar,
  "notion.so": notion,
  "slack.com": slack,
  "linear.app": linear,
  "outlook.com": outlook,
};
export function ActivityIcon({ hostname }: { hostname?: string }) {
  const host = activityHostname(hostname);
  const [failed, setFailed] = useState<string | null>(null);
  if (!host || failed === host) return <Globe className="kova-activity-icon" aria-hidden="true" />;
  return (
    <img
      className="kova-activity-icon rounded-sm object-contain"
      src={logos[host] ?? `/api/activity-icon?host=${encodeURIComponent(host)}`}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailed(host)}
    />
  );
}
