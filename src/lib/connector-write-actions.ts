import { BIGQUERY_WRITE_SCOPE } from "@/integrations/connection-flows.mjs";

export const EXTRA_WRITE_CONNECTORS = [
  "box",
  "calendly",
  "canva",
  "figma",
  "google-bigquery",
  "hubspot",
  "ms-teams",
  "notion",
  "notion-private",
  "salesforce",
  "sharepoint",
  "slack",
  "vercel",
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
  hubspot: {
    scope: "crm.objects.companies.write",
    readConnection: "hubspot",
    action: "Create HubSpot company",
    summary: "Create a company record in the connected HubSpot portal",
    fields: [{ name: "title", label: "Company name", maxLength: 120 }],
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
  vercel: {
    scope: null,
    readConnection: "vercel",
    action: "Create Vercel project",
    summary:
      "Create an empty project in the linked Vercel team. Your token needs permission to create projects.",
    fields: [{ name: "title", label: "Project name", maxLength: 100 }],
  },
};

export function isExtraWriteConnector(connector: string): connector is ExtraWriteConnector {
  return Object.hasOwn(EXTRA_WRITE_ACTIONS, connector);
}
