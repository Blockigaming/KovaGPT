/** User-approved scope. Listing a connector never grants access or marks it live. */
const requested = [
  ["box", "Box"],
  ["calendly", "Calendly"],
  ["canva", "Canva"],
  ["etoro", "eToro"],
  ["excalidraw", "Excalidraw"],
  ["figma", "Figma"],
  ["gamma", "Gamma"],
  ["github", "GitHub"],
  ["gmail", "Gmail"],
  ["google-calendar", "Google Calendar"],
  ["google-bigquery", "Google Cloud BigQuery"],
  ["google-drive", "Google Drive"],
  ["hubspot", "HubSpot"],
  ["hyperframes-heygen", "HyperFrames by HeyGen"],
  ["interactive-brokers", "Interactive Brokers (IBKR)"],
  ["linear", "Linear"],
  ["meltwater", "Meltwater"],
  ["ms-teams", "Microsoft Teams"],
  ["mixpanel", "Mixpanel"],
  ["notion", "Notion"],
  ["onedrive", "OneDrive"],
  ["outlook", "Outlook Mail"],
  ["outlook-calendar", "Outlook Calendar"],
  ["salesforce", "Salesforce"],
  ["sp-global", "S&P Global"],
  ["sharepoint", "SharePoint"],
  ["stripe", "Stripe"],
  ["vercel", "Vercel"],
  ["webull", "Webull"],
  ["wix", "Wix"],
  ["custom-mcp", "Custom MCP connectors (bring your own server)"],
];
const retained = [
  ["slack", "Slack"],
  ["plaid", "Plaid"],
  ["oura", "Oura"],
  ["whoop", "WHOOP"],
  ["apple-health", "Apple Health"],
  ["android-health-connect", "Android Health Connect"],
];
const entries = (rows) => Object.freeze(rows.map(([id, label]) => Object.freeze({ id, label })));

export const USER_REQUESTED_MASTER_CONNECTORS = entries(requested);
export const MASTER_CONNECTORS = entries([...requested, ...retained]);
export const MASTER_CONNECTOR_IDS = Object.freeze(MASTER_CONNECTORS.map(({ id }) => id));

const aliases = {
  "google-bigquery": "BigQuery",
  "hyperframes-heygen": "HeyGen HyperFrames",
  "interactive-brokers": "IBKR",
  "ms-teams": "Teams",
  outlook: "Outlook Mail Outlook Email",
  "sp-global": "S and P Global S&P",
  "custom-mcp": "MCP bring your own server BYO server",
  "apple-health": "Apple HealthKit iOS",
  "android-health-connect": "Android Health Connect Google Health",
};

export function masterConnectorSearchText(id) {
  const entry = MASTER_CONNECTORS.find((item) => item.id === id);
  return entry ? `${entry.label} ${aliases[id] ?? ""}` : "";
}
