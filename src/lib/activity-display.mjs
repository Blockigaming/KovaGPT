// Only hostnames are retained in progress. Never persist signed URLs, paths,
// query strings, credentials, browser text, or tool arguments in this timeline.
export function activityHostname(value) {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,63}$/i.test(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return undefined;
    return host;
  } catch {
    return undefined;
  }
}
const services = [
  ["gmail", "Gmail", "mail.google.com"],
  ["calendar", "Google Calendar", "calendar.google.com"],
  ["drive", "Google Drive", "drive.google.com"],
  ["github", "GitHub", "github.com"],
  ["notion", "Notion", "notion.so"],
  ["slack", "Slack", "slack.com"],
  ["outlook", "Outlook", "outlook.com"],
  ["linear", "Linear", "linear.app"],
  ["salesforce", "Salesforce", "salesforce.com"],
  ["sharepoint", "SharePoint", "sharepoint.com"],
  ["teams", "Microsoft Teams", "teams.microsoft.com"],
];
export function connectorActivity(name) {
  const tool = String(name).toLowerCase();
  const service = services.find(([key]) => tool.includes(key));
  const title = service?.[1] ?? "connected service";
  const verb = /search|list|find|query/.test(tool) ? "Searching" : "Reading";
  return { label: `${verb} ${title}…`, done: `Checked ${title}`, hostname: service?.[2] };
}
