import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { getConnector, type ConnectorItem } from "./connectors-catalog";
import { MASTER_CONNECTOR_IDS } from "./connector-master-list.mjs";
import { EXTRA_WRITE_ACTIONS, isExtraWriteConnector } from "./connector-write-actions";
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
import androidHealthLogo from "../assets/plugins/android-health-connect.png";
import appleHealthLogo from "../assets/plugins/apple-health.png";
import boxLogo from "../assets/plugins/box.svg";
import calendlyLogo from "../assets/plugins/calendly.png";
import canvaLogo from "../assets/plugins/canva.png";
import customMcpLogo from "../assets/plugins/custom-mcp.png";
import etoroLogo from "../assets/plugins/etoro.png";
import excalidrawLogo from "../assets/plugins/excalidraw.svg";
import figmaLogo from "../assets/plugins/figma.svg";
import gammaLogo from "../assets/plugins/gamma.png";
import bigQueryLogo from "../assets/plugins/google-bigquery.svg";
import granolaLogo from "../assets/plugins/granola.png";
import hubspotLogo from "../assets/plugins/hubspot.svg";
import hyperframesLogo from "../assets/plugins/hyperframes-heygen.png";
import interactiveBrokersLogo from "../assets/plugins/interactive-brokers.png";
import meltwaterLogo from "../assets/plugins/meltwater.png";
import mixpanelLogo from "../assets/plugins/mixpanel.svg";
import ouraLogo from "../assets/plugins/oura.png";
import outlookCalendarLogo from "../assets/plugins/outlook-calendar.png";
import plaidLogo from "../assets/plugins/plaid.png";
import spGlobalLogo from "../assets/plugins/sp-global.png";
import stripeLogo from "../assets/plugins/stripe.svg";
import tanaLogo from "../assets/plugins/tana.png";
import vercelLogo from "../assets/plugins/vercel.svg";
import webullLogo from "../assets/plugins/webull.png";
import wixLogo from "../assets/plugins/wix.svg";

/** Bundled brand assets with source and trademark provenance recorded alongside the artwork. */
const pluginBrands: Readonly<Record<string, { src: string; accent: string }>> = {
  gmail: { src: gmailLogo, accent: "#e26558" },
  "google-calendar": { src: googleCalendarLogo, accent: "#3c90ff" },
  "google-drive": { src: googleDriveLogo, accent: "#13ad61" },
  outlook: { src: outlookLogo, accent: "#0078d4" },
  onedrive: { src: onedriveLogo, accent: "#1490df" },
  sharepoint: { src: sharepointLogo, accent: "#0078d4" },
  "ms-teams": { src: msTeamsLogo, accent: "#6264a7" },
  notion: { src: notionLogo, accent: "#000000" },
  github: { src: githubLogo, accent: "#000000" },
  linear: { src: linearLogo, accent: "#222326" },
  slack: { src: slackLogo, accent: "#4a154b" },
  salesforce: { src: salesforceLogo, accent: "#00a1e0" },
  "android-health-connect": { src: androidHealthLogo, accent: "#4285f4" },
  "apple-health": { src: appleHealthLogo, accent: "#ff244e" },
  box: { src: boxLogo, accent: "#0061d5" },
  calendly: { src: calendlyLogo, accent: "#3060b0" },
  canva: { src: canvaLogo, accent: "#00c4cc" },
  "custom-mcp": { src: customMcpLogo, accent: "#000000" },
  etoro: { src: etoroLogo, accent: "#72fc8d" },
  excalidraw: { src: excalidrawLogo, accent: "#6965db" },
  figma: { src: figmaLogo, accent: "#a259ff" },
  gamma: { src: gammaLogo, accent: "#3c63b3" },
  "google-bigquery": { src: bigQueryLogo, accent: "#669df6" },
  granola: { src: granolaLogo, accent: "#151515" },
  hubspot: { src: hubspotLogo, accent: "#ff7a59" },
  "hyperframes-heygen": { src: hyperframesLogo, accent: "#30dfa0" },
  "interactive-brokers": { src: interactiveBrokersLogo, accent: "#e22222" },
  meltwater: { src: meltwaterLogo, accent: "#20c0c0" },
  mixpanel: { src: mixpanelLogo, accent: "#33547d" },
  oura: { src: ouraLogo, accent: "#000000" },
  "outlook-calendar": { src: outlookCalendarLogo, accent: "#305cc0" },
  plaid: { src: plaidLogo, accent: "#1598ae" },
  "sp-global": { src: spGlobalLogo, accent: "#d00030" },
  stripe: { src: stripeLogo, accent: "#635bff" },
  tana: { src: tanaLogo, accent: "#1688c4" },
  vercel: { src: vercelLogo, accent: "#000000" },
  webull: { src: webullLogo, accent: "#2060f0" },
  wix: { src: wixLogo, accent: "#000000" },
};

export const PLUGIN_BRAND_ASSET_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(pluginBrands).map(([id, { src }]) => [id, src]),
);

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
    accent?: string;
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
  const brand = pluginBrands[id];
  if (isExtraWriteConnector(id)) {
    permissions = [
      ...permissions,
      supported(
        "write",
        EXTRA_WRITE_ACTIONS[id].summary,
        "src/lib/connector-write.functions.ts",
        "src/lib/connector-write-requests.server.ts",
      ),
    ];
  }
  if (id === "notion") {
    permissions.push(
      supported(
        "write",
        EXTRA_WRITE_ACTIONS["notion-private"].summary,
        "src/lib/connector-write.functions.ts",
        "src/lib/connector-write-requests.server.ts",
      ),
    );
  }
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
      status: brand ? "verified_local_asset" : "generic_placeholder",
      src: brand?.src ?? "",
      accent: brand?.accent,
      provenance: brand ? "src/assets/plugins/provenance.json" : "",
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
    supported(
      "write",
      "Create a folder in My Drive after review",
      "src/lib/connector-write.functions.ts",
    ),
  ]),
  entry("outlook", [
    proposed("read", "Proposed: search and read selected Outlook mail; scope unconfirmed"),
    supported(
      "write",
      "Save a draft to Outlook after review",
      "src/lib/connector-write.functions.ts",
    ),
    supported(
      "write",
      "Send a reviewed Outlook message with a separate Mail.Send grant",
      "src/lib/connector-write.functions.ts",
    ),
  ]),
  entry("onedrive", [
    proposed("read", "Proposed: search and read selected OneDrive files; scope unconfirmed"),
    supported(
      "write",
      "Create a folder in your OneDrive after review",
      "src/lib/connector-write.functions.ts",
    ),
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
    supported("read", "Search Linear issue titles", "src/integrations/connected-tools.server.ts"),
    supported(
      "write",
      "Create a Linear issue after review",
      "src/lib/connector-write.functions.ts",
    ),
  ]),
  entry("slack", [
    proposed("read", "Proposed: search selected Slack conversations; scope unconfirmed"),
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
  "outlook-calendar": {
    note: "Outlook Calendar requires a Microsoft grant and an accessible default calendar.",
    permissions: [
      supported(
        "write",
        "Create an event on your default calendar after review",
        "src/lib/connector-write.functions.ts",
      ),
    ],
  },
  plaid: {
    note: "Manage bank access in Finances. Connection requires an eligible account and production setup.",
    permissions: [
      supported(
        "read",
        "Read balances and recent transactions for selected bank accounts",
        "src/components/BankConnectionsPanel.tsx",
        "src/routes/api/finances/manage.ts",
      ),
      supported(
        "write",
        "Restore KovaGPT’s Plaid webhook with optional connection maintenance",
        "src/finances/plaid.server.ts",
      ),
    ],
  },
  "interactive-brokers": {
    note: "Flex credentials can read configured reports. Hosted watchlist or other Web API access requires a separate IBKR-approved integration.",
    permissions: [],
  },
  "sp-global": {
    note: "This connector matches companies using licensed Capital IQ reference data. Your license determines access.",
    permissions: [],
  },
  oura: {
    note: "Manage Oura in Health. Oura grants read access to your data after account consent.",
    permissions: [
      supported(
        "read",
        "Read Oura trends for the categories you authorize",
        "src/health/health-accounts.server.ts",
        "src/components/HealthConnectionsPanel.tsx",
      ),
    ],
  },
  "apple-health": {
    note: "Apple Health requires a signed iPhone app. Reading and saving manual steps use separate device permissions.",
    permissions: [
      supported(
        "read",
        "Show approved Apple Health trends on your device",
        "ios/KovaHealth/KovaHealthApp.swift",
      ),
      supported(
        "write",
        "Save manually entered steps after device permission and confirmation",
        "ios/KovaHealth/KovaHealthApp.swift",
      ),
    ],
  },
  "android-health-connect": {
    note: "Health Connect requires a signed Android app. Reading and saving manual steps use separate device permissions.",
    permissions: [
      supported(
        "read",
        "Show approved Android steps, sleep and heart rate on your device",
        "android/app/src/main/java/com/kovagpt/health/HealthReport.kt",
      ),
      supported(
        "write",
        "Save manually entered steps after device permission and confirmation",
        "android/app/src/main/java/com/kovagpt/health/HealthActivity.kt",
      ),
    ],
  },
  excalidraw: {
    note: "Import a scene into chat or draw and export a scene directly from Connections.",
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
  entry("google-docs", []),
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
