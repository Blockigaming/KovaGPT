export type ConnectorTool = {
  name: string;
  mode: "read" | "write";
  requiredScopes: string[];
  consequential: boolean;
};
export const CONNECTOR_TOOLS: Record<string, ConnectorTool[]> = {
  microsoft: [
    {
      name: "onedrive.search",
      mode: "read",
      requiredScopes: ["Files.Read.All"],
      consequential: false,
    },
    {
      name: "outlook.search_mail",
      mode: "read",
      requiredScopes: ["Mail.Read"],
      consequential: false,
    },
    {
      name: "outlook.send_mail",
      mode: "write",
      requiredScopes: ["Mail.Send"],
      consequential: true,
    },
    {
      name: "calendar.create_event",
      mode: "write",
      requiredScopes: ["Calendars.ReadWrite"],
      consequential: true,
    },
  ],
  github: [
    { name: "github.search_code", mode: "read", requiredScopes: ["repo"], consequential: false },
    { name: "github.create_issue", mode: "write", requiredScopes: ["repo"], consequential: true },
  ],
  slack: [
    { name: "slack.search", mode: "read", requiredScopes: ["search:read"], consequential: false },
    {
      name: "slack.send_message",
      mode: "write",
      requiredScopes: ["chat:write"],
      consequential: true,
    },
  ],
  notion: [{ name: "notion.search", mode: "read", requiredScopes: [], consequential: false }],
  linear: [
    { name: "linear.search_issues", mode: "read", requiredScopes: ["read"], consequential: false },
    {
      name: "linear.create_issue",
      mode: "write",
      requiredScopes: ["issues:create"],
      consequential: true,
    },
  ],
  dropbox: [
    {
      name: "dropbox.search",
      mode: "read",
      requiredScopes: ["files.metadata.read"],
      consequential: false,
    },
    {
      name: "dropbox.upload",
      mode: "write",
      requiredScopes: ["files.content.write"],
      consequential: true,
    },
  ],
  box: [
    { name: "box.search", mode: "read", requiredScopes: ["root_readonly"], consequential: false },
  ],
};
export function availableConnectorTools(
  provider: string,
  grantedScopes: string[],
  writesAllowed: boolean,
) {
  const granted = new Set(grantedScopes);
  return (CONNECTOR_TOOLS[provider] ?? []).filter(
    (tool) =>
      tool.requiredScopes.every((scope) => granted.has(scope)) &&
      (tool.mode === "read" || writesAllowed),
  );
}
export function connectorToolNeedsApproval(tool: ConnectorTool) {
  return tool.mode === "write" || tool.consequential;
}
