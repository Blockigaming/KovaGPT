import {
  BIGQUERY_WRITE_SCOPE,
  REVIEWED_MCP_WRITE_SCOPE,
} from "@/integrations/connection-flows.mjs";

export const EXTRA_WRITE_CONNECTORS = [
  "box",
  "calendly",
  "canva",
  "custom-mcp",
  "etoro",
  "figma",
  "gamma",
  "google-bigquery",
  "granola",
  "hubspot",
  "hyperframes-heygen",
  "meltwater",
  "mixpanel",
  "ms-teams",
  "notion",
  "notion-private",
  "salesforce",
  "sharepoint",
  "slack",
  "stripe",
  "tana",
  "vercel",
  "webull",
  "wix",
] as const;

export type ExtraWriteConnector = (typeof EXTRA_WRITE_CONNECTORS)[number];
export type WriteFields = Record<string, string>;

type WriteField = { name: string; label: string; maxLength: number; multiline?: boolean };
type WriteAction = {
  scope: string | null;
  readConnection: string;
  action: string;
  summary: string;
  fields: readonly WriteField[];
};

export const EXTRA_WRITE_ACTIONS: Record<ExtraWriteConnector, WriteAction> = {
  box: {
    scope: "root_readwrite",
    readConnection: "box",
    action: "Create Box folder",
    summary: "Create a folder in the root of your Box account",
    fields: [{ name: "title", label: "Folder name", maxLength: 120 }],
  },
  calendly: {
    scope: "scheduling_links:write",
    readConnection: "calendly",
    action: "Create scheduling link",
    summary: "Create one single-use link for an existing Calendly event type",
    fields: [{ name: "destination", label: "Event type ID or API URL", maxLength: 170 }],
  },
  canva: {
    scope: "design:content:write",
    readConnection: "canva",
    action: "Create Canva design",
    summary: "Create a blank 1080 × 1080 pixel design",
    fields: [{ name: "title", label: "Design title", maxLength: 120 }],
  },
  "custom-mcp": {
    scope: REVIEWED_MCP_WRITE_SCOPE,
    readConnection: "custom-mcp",
    action: "Run approved MCP write",
    summary: "Run the reviewed text action on your linked MCP server.",
    fields: [
      { name: "operation", label: "Approved tool name", maxLength: 128 },
      {
        name: "text",
        label: "Text to send to the approved tool",
        maxLength: 2000,
        multiline: true,
      },
    ],
  },
  etoro: {
    scope: null,
    readConnection: "etoro",
    action: "Create eToro watchlist",
    summary:
      "Create an empty static watchlist on the linked eToro account using a key with watchlist write access.",
    fields: [{ name: "title", label: "Watchlist name", maxLength: 100 }],
  },
  figma: {
    scope: "file_comments:write",
    readConnection: "figma",
    action: "Post Figma comment",
    summary: "Post a comment on the selected Figma file",
    fields: [
      { name: "destination", label: "Figma file key", maxLength: 64 },
      { name: "text", label: "Comment", maxLength: 2000, multiline: true },
    ],
  },
  gamma: {
    scope: "generate",
    readConnection: "gamma",
    action: "Generate Gamma presentation",
    summary:
      "Queue a three-card presentation with no external sharing or generated images. This can use credits in the linked Gamma workspace.",
    fields: [{ name: "text", label: "Presentation brief", maxLength: 2000, multiline: true }],
  },
  "google-bigquery": {
    scope: BIGQUERY_WRITE_SCOPE,
    readConnection: "google-bigquery",
    action: "Create BigQuery dataset",
    summary: "Create an empty dataset in the selected Google Cloud project and location",
    fields: [
      { name: "destination", label: "Google Cloud project ID", maxLength: 30 },
      { name: "title", label: "Dataset ID", maxLength: 128 },
      { name: "location", label: "Dataset location", maxLength: 40 },
    ],
  },
  granola: {
    scope: null,
    readConnection: "granola",
    action: "Pause or resume a Granola webhook",
    summary:
      "Update delivery for an existing webhook. Granola requires a Business or Enterprise plan and a key authorized to manage that webhook.",
    fields: [
      { name: "destination", label: "Webhook endpoint ID", maxLength: 128 },
      { name: "delivery", label: "Delivery (pause or resume)", maxLength: 6 },
    ],
  },
  hubspot: {
    scope: "crm.objects.companies.write",
    readConnection: "hubspot",
    action: "Create HubSpot company",
    summary: "Create a company record in the connected HubSpot portal",
    fields: [{ name: "title", label: "Company name", maxLength: 120 }],
  },
  "hyperframes-heygen": {
    scope: null,
    readConnection: "hyperframes-heygen",
    action: "Queue HyperFrames render",
    summary:
      "Render an existing HyperFrames project asset on the linked HeyGen account. Submitting a render can use HeyGen credits.",
    fields: [
      { name: "destination", label: "HeyGen project ZIP asset ID", maxLength: 128 },
      { name: "title", label: "Render title", maxLength: 120 },
      { name: "requestId", label: "Request UUID (reuse for the same render)", maxLength: 36 },
    ],
  },
  meltwater: {
    scope: null,
    readConnection: "meltwater",
    action: "Create Meltwater saved search",
    summary:
      "Save the reviewed Boolean query in the linked Meltwater account. The API key needs permission to manage saved searches.",
    fields: [
      { name: "title", label: "Search name", maxLength: 120 },
      { name: "text", label: "Boolean query", maxLength: 2000, multiline: true },
    ],
  },
  mixpanel: {
    scope: null,
    readConnection: "mixpanel",
    action: "Import Mixpanel event",
    summary:
      "Import one event into the linked project and data region using a service account with ingestion access.",
    fields: [
      { name: "title", label: "Event name", maxLength: 120 },
      { name: "destination", label: "Distinct ID", maxLength: 128 },
      { name: "time", label: "Event timestamp (UTC, YYYY-MM-DDTHH:mm:ssZ)", maxLength: 20 },
      { name: "eventId", label: "Unique event ID for deduplication", maxLength: 64 },
    ],
  },
  "ms-teams": {
    scope: "ChatMessage.Send",
    readConnection: "ms-teams-messages",
    action: "Send Teams message",
    summary: "Send a plain-text message to an existing Teams chat",
    fields: [
      { name: "destination", label: "Teams chat ID", maxLength: 256 },
      { name: "text", label: "Message", maxLength: 2000, multiline: true },
    ],
  },
  notion: {
    scope: null,
    readConnection: "notion",
    action: "Append Notion paragraph",
    summary:
      "Add a paragraph to a shared Notion page. The public Notion app needs Insert content permission.",
    fields: [
      { name: "destination", label: "Notion page ID", maxLength: 36 },
      { name: "text", label: "Paragraph", maxLength: 2000, multiline: true },
    ],
  },
  "notion-private": {
    scope: null,
    readConnection: "notion-private",
    action: "Append Notion paragraph",
    summary:
      "Add a paragraph to the bound Notion page. The integration token needs Insert content permission in Notion.",
    fields: [{ name: "text", label: "Paragraph", maxLength: 2000, multiline: true }],
  },
  salesforce: {
    scope: "api",
    readConnection: "salesforce",
    action: "Create Salesforce account",
    summary: "Create an account record in the linked Salesforce organization",
    fields: [{ name: "title", label: "Account name", maxLength: 120 }],
  },
  sharepoint: {
    scope: "Sites.ReadWrite.All",
    readConnection: "sharepoint",
    action: "Create SharePoint list item",
    summary: "Add an item to an existing SharePoint list that accepts a Title",
    fields: [
      { name: "destination", label: "SharePoint site ID", maxLength: 256 },
      { name: "listId", label: "List UUID", maxLength: 36 },
      { name: "title", label: "Item title", maxLength: 120 },
    ],
  },
  slack: {
    scope: "chat:write",
    readConnection: "slack",
    action: "Send Slack message",
    summary: "Send a message to the selected Slack conversation",
    fields: [
      { name: "destination", label: "Slack conversation ID", maxLength: 32 },
      { name: "text", label: "Message", maxLength: 2000, multiline: true },
    ],
  },
  stripe: {
    scope: null,
    readConnection: "stripe",
    action: "Create Stripe draft invoice",
    summary:
      "Create an empty, unfinalized draft for a customer on the linked account. The installed Stripe App needs invoice write permission.",
    fields: [{ name: "destination", label: "Stripe customer ID", maxLength: 128 }],
  },
  tana: {
    scope: null,
    readConnection: "tana",
    action: "Propose Tana documents",
    summary:
      "Request document creation in the linked Tana workspace. Review and apply the proposal inside Tana.",
    fields: [
      { name: "argumentsJson", label: "Document request (JSON)", maxLength: 2000, multiline: true },
    ],
  },
  vercel: {
    scope: null,
    readConnection: "vercel",
    action: "Create Vercel project",
    summary:
      "Create an empty project in the linked Vercel team. Your token needs permission to create projects.",
    fields: [{ name: "title", label: "Project name", maxLength: 100 }],
  },
  webull: {
    scope: null,
    readConnection: "webull",
    action: "Create Webull watchlist",
    summary:
      "Create an empty watchlist in the linked Webull environment. The account needs a Webull access token with watchlist permissions.",
    fields: [{ name: "title", label: "Watchlist name", maxLength: 100 }],
  },
  wix: {
    scope: null,
    readConnection: "wix",
    action: "Update Wix business name",
    summary:
      "Replace the public business name on the linked Wix site. The app needs Manage Business Profile permission.",
    fields: [{ name: "title", label: "New business name", maxLength: 120 }],
  },
};

export function isExtraWriteConnector(connector: string): connector is ExtraWriteConnector {
  return Object.hasOwn(EXTRA_WRITE_ACTIONS, connector);
}
