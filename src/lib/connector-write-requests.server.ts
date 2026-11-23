import {
  EXTRA_WRITE_ACTIONS,
  type ExtraWriteConnector,
  type WriteFields,
} from "./connector-write-actions";
import { salesforceQueryUrl } from "@/integrations/salesforce-credential.server.mjs";

type WriteRequest = {
  url: string;
  method?: "PATCH";
  credentialHeader?: "apikey";
  body: Record<string, unknown>;
  header?: Record<string, string>;
  status: number;
  confirmed: (data: Record<string, unknown>) => boolean;
  outputLink?: (data: Record<string, unknown>) => string | undefined;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const object = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const hasId = (data: Record<string, unknown>) =>
  typeof data.id === "string" && data.id.length > 0 && data.id.length < 300;
const graph = "https://graph.microsoft.com/v1.0";

function calendlyLink(data: Record<string, unknown>) {
  const booking = object(data.resource)?.booking_url;
  if (typeof booking !== "string" || booking.length > 512) return undefined;
  const url = new URL(booking);
  return url.origin === "https://calendly.com" && !url.username && !url.password
    ? url.href
    : undefined;
}

export function connectorWriteRequest(
  connector: ExtraWriteConnector,
  input: WriteFields,
  binding?: { notionPageId?: string; salesforceQuery?: string; vercelTeamId?: string },
): WriteRequest | null {
  const fields = EXTRA_WRITE_ACTIONS[connector].fields;
  if (
    Object.keys(input).length !== fields.length ||
    fields.some(
      ({ name, maxLength }) =>
        !Object.hasOwn(input, name) || !input[name].trim() || input[name].length > maxLength,
    )
  )
    return null;
  const { destination, listId, text, title, location } = input;
  switch (connector) {
    case "box":
      if (
        title === "." ||
        title === ".." ||
        [...title].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "/\\".includes(char),
        )
      )
        return null;
      return {
        url: "https://api.box.com/2.0/folders",
        status: 201,
        confirmed: hasId,
        body: { name: title, parent: { id: "0" } },
      };
    case "calendly": {
      const id = destination.replace(/^https:\/\/api\.calendly\.com\/event_types\//u, "");
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) return null;
      const owner = `https://api.calendly.com/event_types/${id}`;
      return {
        url: "https://api.calendly.com/scheduling_links",
        status: 201,
        confirmed: (data) => object(data.resource)?.owner === owner && Boolean(calendlyLink(data)),
        outputLink: calendlyLink,
        body: {
          max_event_count: 1,
          owner,
          owner_type: "EventType",
        },
      };
    }
    case "canva":
      return {
        url: "https://api.canva.com/rest/v1/designs",
        status: 200,
        confirmed: (data) => hasId(object(data.design) ?? {}),
        body: { title, design_type: { type: "custom", width: 1080, height: 1080 } },
      };
    case "figma":
      if (!/^[A-Za-z0-9]{1,64}$/u.test(destination)) return null;
      return {
        url: `https://api.figma.com/v1/files/${destination}/comments`,
        status: 200,
        confirmed: hasId,
        body: { message: text },
      };
    case "google-bigquery":
      if (
        !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(destination) ||
        !/^[A-Za-z0-9_]{1,128}$/u.test(title) ||
        !/^[A-Za-z][A-Za-z0-9-]{1,39}$/u.test(location)
      )
        return null;
      return {
        url: `https://bigquery.googleapis.com/bigquery/v2/projects/${destination}/datasets`,
        status: 200,
        confirmed: (data) => {
          const reference = object(data.datasetReference);
          return reference?.projectId === destination && reference.datasetId === title;
        },
        body: { datasetReference: { projectId: destination, datasetId: title }, location },
      };
    case "hubspot":
      return {
        url: "https://api.hubapi.com/crm/v3/objects/companies",
        status: 201,
        confirmed: hasId,
        body: { properties: { name: title } },
      };
    case "meltwater":
      return {
        url: "https://api.meltwater.com/v3/searches",
        credentialHeader: "apikey",
        status: 201,
        confirmed: (data) => {
          const search = object(data.search);
          return Number.isSafeInteger(search?.id) && search?.name === title;
        },
        body: {
          search: {
            name: title,
            query: { boolean: text, case_sensitivity: "no", type: "boolean" },
          },
        },
      };
    case "ms-teams":
      if (!/^19:[A-Za-z0-9_.@-]+@thread\.(?:v2|skype)$/u.test(destination)) return null;
      return {
        url: `${graph}/chats/${encodeURIComponent(destination)}/messages`,
        status: 201,
        confirmed: hasId,
        body: { body: { contentType: "text", content: text } },
      };
    case "notion":
    case "notion-private": {
      const page = connector === "notion-private" ? binding?.notionPageId : destination;
      if (!page || (!uuid.test(page) && !/^[A-Fa-f0-9]{32}$/u.test(page))) return null;
      return {
        url: `https://api.notion.com/v1/blocks/${page}/children`,
        method: "PATCH",
        status: 200,
        header: { "Notion-Version": "2026-03-11" },
        confirmed: (data) =>
          data.object === "list" &&
          Array.isArray(data.results) &&
          data.results.length === 1 &&
          data.results[0]?.type === "paragraph" &&
          hasId(data.results[0]),
        body: {
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: text } }],
              },
            },
          ],
        },
      };
    }
    case "salesforce": {
      const queryUrl = salesforceQueryUrl(binding?.salesforceQuery);
      return {
        url: queryUrl.href.replace(/\/query$/u, "/sobjects/Account/"),
        status: 201,
        confirmed: (data) =>
          data.success === true &&
          typeof data.id === "string" &&
          /^001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u.test(data.id),
        body: { Name: title },
      };
    }
    case "sharepoint": {
      const [host, site, web, extra] = destination.split(",");
      if (
        extra !== undefined ||
        !/^[A-Za-z0-9.-]+$/u.test(host) ||
        !uuid.test(site) ||
        !uuid.test(web) ||
        !uuid.test(listId)
      )
        return null;
      return {
        url: `${graph}/sites/${encodeURIComponent(destination)}/lists/${listId}/items`,
        status: 201,
        confirmed: hasId,
        body: { fields: { Title: title } },
      };
    }
    case "slack":
      if (!/^[CGD][A-Z0-9]{8,31}$/u.test(destination)) return null;
      return {
        url: "https://slack.com/api/chat.postMessage",
        status: 200,
        confirmed: (data) =>
          data.ok === true &&
          data.channel === destination &&
          typeof data.ts === "string" &&
          /^\d{1,20}\.\d{1,8}$/u.test(data.ts),
        body: {
          channel: destination,
          text,
          mrkdwn: false,
          unfurl_links: false,
          unfurl_media: false,
        },
      };
    case "vercel": {
      const teamId = binding?.vercelTeamId;
      if (
        !teamId ||
        !/^team_[A-Za-z0-9]{1,128}$/u.test(teamId) ||
        !/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(title) ||
        title.includes("---")
      )
        return null;
      return {
        url: `https://api.vercel.com/v11/projects?teamId=${teamId}`,
        status: 200,
        confirmed: (data) => data.accountId === teamId && data.name === title && hasId(data),
        body: { name: title },
      };
    }
  }
}
