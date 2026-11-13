import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { getConnector, type ConnectorItem } from "./connectors-catalog";
import { MASTER_CONNECTOR_IDS } from "./connector-master-list.mjs";
import gmailLogo from "../assets/plugins/gmail.svg";
import googleCalendarLogo from "../assets/plugins/google-calendar.svg";
import googleDriveLogo from "../assets/plugins/google-drive.svg";
import outlookLogo from "../assets/plugins/outlook.svg";
import onedriveLogo from "../assets/plugins/onedrive.svg";
import githubLogo from "../assets/plugins/github.svg";
import notionLogo from "../assets/plugins/notion.svg";
import linearLogo from "../assets/plugins/linear.svg";
import plaidLogo from "../assets/plugins/plaid.svg";

export type PluginReviewPermission = {
  access: "read" | "write";
  label: string;
  status: "supported" | "planned";
};

export type PluginReview = {
  connector: ConnectorItem;
  availability: "implemented" | "planned";
  availabilityNote: string;
  permissions: readonly PluginReviewPermission[];
  brandAsset: {
    status: "verified_local_asset" | "generic_placeholder";
    src: string;
  };
};

const SUPPORTED = (label: string): PluginReviewPermission => ({
  access: "read",
  label,
  status: "supported",
});

const SUPPORTED_WRITE = (label: string): PluginReviewPermission => ({
  access: "write",
  label,
  status: "supported",
});

const PLANNED = (label: string, access: "read" | "write" = "read"): PluginReviewPermission => ({
  access,
  label,
  status: "planned",
});

export const PLUGIN_BRAND_ASSET_URLS: Record<string, string> = {
  gmail: gmailLogo,
  "google-calendar": googleCalendarLogo,
  "google-drive": googleDriveLogo,
  outlook: outlookLogo,
  onedrive: onedriveLogo,
  github: githubLogo,
  notion: notionLogo,
  linear: linearLogo,
  plaid: plaidLogo,
};

function supported(label: string, access: "read" | "write" = "read"): PluginReviewPermission {
  return access === "write" ? SUPPORTED_WRITE(label) : SUPPORTED(label);
}

function getPluginReview(id: string): PluginReview | null {
  const connector = getConnector(id);
  if (!connector) return null;
  const implemented =
    ["gmail", "google-calendar", "google-drive", "github", "plaid"].includes(id) ||
    Boolean(CONNECTION_FLOWS[id]);
  return {
    connector,
    availability: implemented ? "implemented" : "planned",
    availabilityNote: implemented
      ? "Integration code exists. Current availability and account connection must be checked separately."
      : "Planned interface only. No connection flow or provider operations are enabled here.",
    permissions: CONNECTION_FLOWS[id]
      ? [
          supported("Account identity"),
          ...(id === "gmail"
            ? [supported("Read messages"), supported("Send email", "write")]
            : id === "google-calendar"
              ? [supported("Read events"), supported("Create events", "write")]
              : id === "google-drive"
                ? [supported("Read files")]
                : id === "github"
                  ? [supported("Read repositories"), supported("Read issues")]
                  : id === "plaid"
                    ? [supported("Read balances"), supported("Read transactions")]
                    : [supported("Connected account data")]),
        ]
      : [PLANNED("Provider access")],
    brandAsset: {
      status: PLUGIN_BRAND_ASSET_URLS[id] ? "verified_local_asset" : "generic_placeholder",
      src: PLUGIN_BRAND_ASSET_URLS[id] ?? "",
    },
  };
}

export function getPluginReviewEntry(id: string) {
  return getPluginReview(id);
}

export const MASTER_PLUGIN_REVIEW_CATALOG = MASTER_CONNECTOR_IDS.map((id) => getPluginReview(id)!).filter(Boolean);

export const PLUGIN_REVIEW_PERMISSION_NOTICE =
  "Permissions shown here describe the product surface, not a live OAuth grant.";

export function describePluginReview(id: string) {
  const review = getPluginReview(id);
  if (!review) return null;
  const describe = (item: PluginReviewPermission) => item.label;
  return {
    id,
    availability: review.availability,
    read: review.permissions.filter((item) => item.access === "read").map(describe),
    write: review.permissions.filter((item) => item.access === "write").map(describe),
    permissions: review.permissions.map(
      (item) => `${item.access === "read" ? "Read" : "Write"}: ${describe(item)}`,
    ),
    availabilityNote: `${review.availabilityNote} ${PLUGIN_REVIEW_PERMISSION_NOTICE}`,
  };
}
