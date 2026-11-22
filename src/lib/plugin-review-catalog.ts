import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { getConnector, type ConnectorItem } from "./connectors-catalog";
import { MASTER_CONNECTOR_IDS } from "./connector-master-list.mjs";
import gmailLogo from "../assets/plugins/gmail.svg";
import googleCalendarLogo from "../assets/plugins/google-calendar.svg";
import googleDriveLogo from "../assets/plugins/google-drive.svg";
import outlookLogo from "../assets/plugins/outlook.svg";
import onedriveLogo from "../assets/plugins/onedrive.svg";
import sharepointLogo from "../assets/plugins/sharepoint.svg";
import msTeamsLogo from "../assets/plugins/microsoft-teams.svg";
import notionLogo from "../assets/plugins/notion.svg";
import githubLogo from "../assets/plugins/github.svg";
import linearLogo from "../assets/plugins/linear.svg";
import slackLogo from "../assets/plugins/slack.svg";
import salesforceLogo from "../assets/plugins/salesforce.svg";

/** Package-sourced brand assets; license and trademark provenance are recorded alongside the SVGs. */
export const PLUGIN_BRAND_ASSET_URLS: Readonly<Record<string, string>> = {
  gmail: gmailLogo,
  "google-calendar": googleCalendarLogo,
  "google-drive": googleDriveLogo,
  outlook: outlookLogo,
  onedrive: onedriveLogo,
  sharepoint: sharepointLogo,
  "ms-teams": msTeamsLogo,
  notion: notionLogo,
  github: githubLogo,
  linear: linearLogo,
  slack: slackLogo,
  salesforce: salesforceLogo,
};

/** Presentation-only launch review metadata. Never an authorization/connection registry. */
export type PluginReviewPermission = {
  access: "read" | "write";
  label: string;
  verification: "source_contract" | "proposal_unconfirmed";
  /** Local implementation evidence, not a claim about deployment or granted scopes. */
  sourceFiles: readonly string[];
};
export type PluginReviewEntry = {
  connector: ConnectorItem;
  availability: "implemented" | "planned";
  availabilityNote: string;
  permissions: readonly PluginReviewPermission[];
  brandAsset: {
    status: "verified_local_asset" | "generic_placeholder";
    src: string;
    provenance: string;
  };
};

export const PLUGIN_REVIEW_PERMISSION_NOTICE =
  "Review only. Source-backed capabilities still depend on deployment configuration, account grants and action approval. Unconfirmed proposals are not requested permissions or available operations.";

const proposed = (access: "read" | "write", label: string): PluginReviewPermission => ({
  access,
  label,
  verification: "proposal_unconfirmed",
  sourceFiles: [],
});
const supported = (
  access: "read" | "write",
  label: string,
  ...sourceFiles: string[]
): PluginReviewPermission => ({ access, label, verification: "source_contract", sourceFiles });

function entry(id: string, permissions: PluginReviewPermission[]): PluginReviewEntry {
  const connector = getConnector(id);
  if (!connector) throw new Error(`Missing launch review connector: ${id}`);
  const implemented =
    permissions.some(({ verification }) => verification === "source_contract") ||
    Object.hasOwn(CONNECTION_FLOWS, id);
  return {
    connector,
    availability: implemented ? "implemented" : "planned",
    availabilityNote: implemented
      ? "Integration code exists. Current availability and account connection must be checked separately."
      : "Planned interface only. No connection flow or provider operations are enabled here.",
    permissions: CONNECTION_FLOWS[id]
      ? [
          supported(
            "read",
            CONNECTION_FLOWS[id].description,
            "src/integrations/connection-read.server.mjs",
            "src/integrations/connected-tools.server.ts",
          ),
          ...permissions.filter(
            (permission) =>
              permission.verification === "source_contract" || permission.access === "write",
          ),
        ]
      : permissions,
    brandAsset: {
      status: PLUGIN_BRAND_ASSET_URLS[id] ? "verified_local_asset" : "generic_placeholder",
      src: PLUGIN_BRAND_ASSET_URLS[id] ?? "",
      provenance: PLUGIN_BRAND_ASSET_URLS[id] ? "src/assets/plugins/provenance.json" : "",
    },
  };
}

export const LAUNCH_PLUGIN_REVIEW_CATALOG: readonly PluginReviewEntry[] = [
  entry("gmail", [
    supported(
      "read",
      "Read Gmail message context",
      "src/lib/google-account-policy.mjs",
      "src/lib/google-tools.server.ts",
    ),
    supported(
      "write",
      "Prepare drafts and review a message before sending",
      "src/lib/google-tools.server.ts",
      "src/lib/google-write-validation.server.mjs",
    ),
  ]),
  entry("google-calendar", [
    supported(
      "read",
      "Read calendar events",
      "src/lib/google-account-policy.mjs",
      "src/lib/google-tools.server.ts",
    ),
    supported(
      "write",
      "Review calendar event changes before applying them",
      "src/lib/google-tools.server.ts",
      "src/lib/google-write-validation.server.mjs",
    ),
  ]),
  entry("google-drive", [
    supported(
      "read",
      "Read and reference Drive files",
      "src/lib/google-account-policy.mjs",
      "src/lib/google-tools.server.ts",
    ),
    proposed(
      "write",
      "Proposed: create or update selected Drive files; scope and implementation unconfirmed",
    ),
  ]),
  entry("outlook", [
    proposed("read", "Proposed: search and read selected Outlook mail; scope unconfirmed"),
    proposed("write", "Proposed: draft or send Outlook mail after review; scope unconfirmed"),
  ]),
  entry("onedrive", [
    proposed("read", "Proposed: search and read selected OneDrive files; scope unconfirmed"),
    proposed("write", "Proposed: create or update selected OneDrive files; scope unconfirmed"),
  ]),
  entry("sharepoint", [
    proposed("read", "Proposed: search selected SharePoint sites and documents; scope unconfirmed"),
    proposed(
      "write",
      "Proposed: update selected SharePoint documents after review; scope unconfirmed",
    ),
  ]),
  entry("ms-teams", [
    supported(
      "read",
      CONNECTION_FLOWS["ms-teams-messages"].description,
      "src/integrations/connection-read.server.mjs",
      "src/integrations/connected-tools.server.ts",
    ),
    proposed("write", "Proposed: send a Teams message after review; scope unconfirmed"),
  ]),
  entry("notion", [
    proposed(
      "write",
      "Proposed: create or edit shared Notion pages after review; scope unconfirmed",
    ),
  ]),
  entry("github", [
    supported(
      "read",
      "Read explicitly authorized repositories, files, issues and pull requests",
      "src/lib/github-connector.mjs",
    ),
    supported(
      "write",
      "Review issue and repository changes before applying them",
      "src/lib/github-connector.mjs",
    ),
  ]),
  entry("linear", [
    proposed("read", "Proposed: read selected Linear issues and projects; scope unconfirmed"),
    proposed("write", "Proposed: create or update Linear issues after review; scope unconfirmed"),
  ]),
  entry("slack", [
    proposed("read", "Proposed: search selected Slack conversations; scope unconfirmed"),
    proposed("write", "Proposed: send a Slack message after review; scope unconfirmed"),
  ]),
  entry("salesforce", [
    proposed(
      "read",
      "Proposed: read selected Salesforce accounts, contacts and opportunities; scope unconfirmed",
    ),
    proposed(
      "write",
      "Proposed: update selected Salesforce records after review; scope unconfirmed",
    ),
  ]),
];

const dedicatedConnections: Record<
  string,
  { note: string; permissions: PluginReviewPermission[] }
> = {
  plaid: {
    note: "Manage bank access in Finances. Connection requires an eligible account and production setup.",
    permissions: [
      supported(
        "read",
        "Read balances and recent transactions for selected bank accounts",
        "src/components/BankConnectionsPanel.tsx",
        "src/routes/api/finances/manage.ts",
      ),
    ],
  },
  oura: {
    note: "Manage Oura in Health. Connection requires Oura developer credentials and account consent.",
    permissions: [
      supported(
        "read",
        "Read Oura trends for the categories you authorize",
        "src/health/health-accounts.server.ts",
        "src/components/HealthConnectionsPanel.tsx",
      ),
    ],
  },
  whoop: {
    note: "Manage WHOOP in Health. Connection requires WHOOP developer credentials and account consent.",
    permissions: [
      supported(
        "read",
        "Read WHOOP sleep, recovery, strain, and resting heart rate with your approval",
        "src/health/health-read.server.mjs",
        "src/components/HealthConnectionsPanel.tsx",
      ),
    ],
  },
  "apple-health": {
    note: "The native mobile companion reads Apple Health with iPhone permissions. Availability depends on a signed app install.",
    permissions: [
      supported(
        "read",
        "Show approved Apple Health trends on your device",
        "ios/KovaHealth/KovaHealthApp.swift",
      ),
    ],
  },
  "android-health-connect": {
    note: "The native mobile companion reads Health Connect with Android permissions. Availability depends on a signed app install.",
    permissions: [
      supported(
        "read",
        "Show approved Android steps, sleep and heart rate on your device",
        "android/app/src/main/java/com/kovagpt/health/HealthReport.kt",
      ),
    ],
  },
  excalidraw: {
    note: "Exchange .excalidraw files through Kova chat. File access starts when you select a scene.",
    permissions: [
      supported("read", "Import a diagram you select", "src/lib/excalidraw-scene.mjs"),
      supported(
        "write",
        "Download your sketch as an editable local diagram",
        "src/components/ComposerDrawingDialog.tsx",
      ),
    ],
  },
};

/** Complete approved directory; runtime configuration and grants remain authoritative. */
export const MASTER_PLUGIN_REVIEW_CATALOG: readonly PluginReviewEntry[] = [
  ...LAUNCH_PLUGIN_REVIEW_CATALOG,
  ...MASTER_CONNECTOR_IDS.filter(
    (id) => !LAUNCH_PLUGIN_REVIEW_CATALOG.some((item) => item.connector.id === id),
  ).map((id) => {
    const dedicated = dedicatedConnections[id];
    const review = entry(id, dedicated?.permissions ?? []);
    return dedicated ? { ...review, availabilityNote: dedicated.note } : review;
  }),
];

export function getPluginReview(id: string): PluginReviewEntry | undefined {
  return MASTER_PLUGIN_REVIEW_CATALOG.find((entry) => entry.connector.id === id);
}

/** Display model only; never use these labels to select or authorize adapter calls. */
export function getPluginPreviewProvider(id: string) {
  const review = getPluginReview(id);
  if (!review) return undefined;
  const describe = (permission: PluginReviewPermission) =>
    permission.verification === "proposal_unconfirmed"
      ? `Unconfirmed proposal: ${permission.label.replace(/^Proposed: /, "")}`
      : `Source-backed capability (grant required): ${permission.label}`;
  return {
    id: review.connector.id,
    label: review.connector.label,
    description:
      review.availability === "planned"
        ? `Planned interface: ${review.connector.description}`
        : review.connector.description,
    readCapabilities: review.permissions.filter((item) => item.access === "read").map(describe),
    writeCapabilities: review.permissions.filter((item) => item.access === "write").map(describe),
    permissions: review.permissions.map(
      (item) => `${item.access === "read" ? "Read" : "Write"}: ${describe(item)}`,
    ),
    availabilityNote: `${review.availabilityNote} ${PLUGIN_REVIEW_PERMISSION_NOTICE}`,
  };
}
