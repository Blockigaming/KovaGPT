import {
  EXTRA_WRITE_ACTIONS,
  type ExtraWriteConnector,
  type WriteFields,
} from "./connector-write-actions";
import { salesforceQueryUrl } from "@/integrations/salesforce-credential.server.mjs";
import { WEBULL_ORIGINS } from "@/integrations/key-connection-credential.server.mjs";

type WriteRequest = {
  url: string;
  method?: "PATCH";
  credentialHeader?: "apikey" | "X-Api-Key";
  body?: Record<string, unknown> | Record<string, unknown>[] | URLSearchParams;
  header?: Record<string, string>;
  status: number;
  confirmed: (data: Record<string, unknown>) => boolean;
  outputLink?: (data: Record<string, unknown>) => string | undefined;
  outputReference?: (data: Record<string, unknown>) => string | undefined;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const object = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const hasId = (data: Record<string, unknown>) =>
  typeof data.id === "string" && data.id.length > 0 && data.id.length < 300;
const graph = "https://graph.microsoft.com/v1.0";
const renderId = (data: Record<string, unknown>) => {
  const id = object(data.data)?.render_id;
  return typeof id === "string" && /^hfr_[A-Za-z0-9_-]{1,124}$/u.test(id) ? id : undefined;
};
const gammaGenerationId = (data: Record<string, unknown>) =>
  typeof data.generationId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(data.generationId)
    ? data.generationId
    : undefined;
const mixpanelIngestion = {
  us: "https://api.mixpanel.com",
  eu: "https://api-eu.mixpanel.com",
  in: "https://api-in.mixpanel.com",
} as const;

function calendlyLink(data: Record<string, unknown>) {
  const booking = object(data.resource)?.booking_url;
  if (typeof booking !== "string" || booking.length > 512) return undefined;
  const url = new URL(booking);
  return url.origin === "https://calendly.com" && !url.username && !url.password
    ? url.href
    : undefined;
}

export function connectorWriteFieldsValid(connector: ExtraWriteConnector, input: WriteFields) {
  const fields = EXTRA_WRITE_ACTIONS[connector].fields;
  return (
    Object.keys(input).length === fields.length &&
    fields.every(
      ({ name, maxLength }) =>
        Object.hasOwn(input, name) && input[name].trim() && input[name].length <= maxLength,
    )
  );
}

export function connectorWriteRequest(
  connector: ExtraWriteConnector,
  input: WriteFields,
  binding?: {
    notionPageId?: string;
    salesforceQuery?: string;
    vercelTeamId?: string;
    mixpanel?: { region: keyof typeof mixpanelIngestion; projectId: string };
    webullEnvironment?: keyof typeof WEBULL_ORIGINS;
  },
): WriteRequest | null {
  if (!connectorWriteFieldsValid(connector, input)) return null;
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
    case "custom-mcp":
    case "tana":
      return null;
    case "etoro": {
      const params = new URLSearchParams({ name: title, type: "Static" });
      return {
        url: `https://public-api.etoro.com/api/v1/watchlists?${params}`,
        status: 201,
        confirmed: (data) =>
          data.isSucceeded === true &&
          Array.isArray(data.watchlists) &&
          data.watchlists.some(
            (watchlist) =>
              watchlist?.name === title &&
              typeof watchlist.watchlistId === "string" &&
              /^[A-Za-z0-9_-]{1,128}$/u.test(watchlist.watchlistId),
          ),
      };
    }
    case "figma":
      if (!/^[A-Za-z0-9]{1,64}$/u.test(destination)) return null;
      return {
        url: `https://api.figma.com/v1/files/${destination}/comments`,
        status: 200,
        confirmed: hasId,
        body: { message: text },
      };
    case "gamma":
      return {
        url: "https://public-api.gamma.app/v1.0/generations",
        status: 200,
        confirmed: (data) => Boolean(gammaGenerationId(data)),
        outputReference: gammaGenerationId,
        body: {
          inputText: text,
          format: "presentation",
          textMode: "generate",
          numCards: 3,
          imageOptions: { source: "noImages" },
          sharingOptions: { workspaceAccess: "noAccess", externalAccess: "noAccess" },
        },
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
    case "granola": {
      const { delivery } = input;
      if (
        !/^whe_[A-Za-z0-9_-]{1,124}$/u.test(destination) ||
        !["pause", "resume"].includes(delivery)
      )
        return null;
      const enabled = delivery === "resume";
      return {
        url: `https://public-api.granola.ai/v1/webhook-endpoints/${destination}`,
        method: "PATCH",
        status: 200,
        confirmed: (data) =>
          data.id === destination && data.object === "webhook_endpoint" && data.enabled === enabled,
        body: { enabled },
      };
    }
    case "hubspot":
      return {
        url: "https://api.hubapi.com/crm/v3/objects/companies",
        status: 201,
        confirmed: hasId,
        body: { properties: { name: title } },
      };
    case "hyperframes-heygen":
      if (!/^asst_[A-Za-z0-9_-]{1,123}$/u.test(destination) || !uuid.test(input.requestId))
        return null;
      return {
        url: "https://api.heygen.com/v3/hyperframes/renders",
        credentialHeader: "X-Api-Key",
        header: { "Idempotency-Key": input.requestId },
        status: 202,
        confirmed: (data) => !data.error && Boolean(renderId(data)),
        outputReference: renderId,
        body: {
          project: { type: "asset_id", asset_id: destination },
          title,
          format: "mp4",
          quality: "standard",
        },
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
    case "mixpanel": {
      const project = binding?.mixpanel;
      const time = Date.parse(input.time);
      if (
        !project ||
        !Object.hasOwn(mixpanelIngestion, project.region) ||
        !/^[1-9][0-9]{0,14}$/u.test(project.projectId) ||
        !/^[A-Za-z0-9_.:-]{1,128}$/u.test(destination) ||
        !/^[A-Za-z0-9_.:-]{1,64}$/u.test(input.eventId) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(input.time) ||
        !Number.isFinite(time) ||
        new Date(time).toISOString() !== input.time.replace("Z", ".000Z")
      )
        return null;
      return {
        url: `${mixpanelIngestion[project.region]}/import?strict=1&project_id=${project.projectId}`,
        status: 200,
        confirmed: (data) => data.code === 200 && data.num_records_imported === 1,
        body: [
          {
            event: title,
            properties: { time, distinct_id: destination, $insert_id: input.eventId, ip: 0 },
          },
        ],
      };
    }
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
    case "stripe":
      if (!/^cus_[A-Za-z0-9]{1,124}$/u.test(destination)) return null;
      return {
        url: "https://api.stripe.com/v1/invoices",
        status: 200,
        header: { "Stripe-Version": "2026-11-18.endive" },
        confirmed: (data) =>
          data.object === "invoice" &&
          data.customer === destination &&
          data.status === "draft" &&
          data.amount_due === 0 &&
          data.auto_advance === false &&
          hasId(data),
        body: new URLSearchParams({
          customer: destination,
          auto_advance: "false",
          pending_invoice_items_behavior: "exclude",
        }),
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
    case "webull": {
      const environment = binding?.webullEnvironment;
      if (!environment || !Object.hasOwn(WEBULL_ORIGINS, environment)) return null;
      return {
        url: `${WEBULL_ORIGINS[environment]}/market-data/watchlists/create`,
        status: 200,
        confirmed: (data) =>
          typeof data.watchlist_id === "string" &&
          /^[A-Za-z0-9_-]{1,100}$/u.test(data.watchlist_id),
        body: { name: title },
      };
    }
    case "wix":
      return {
        url: "https://www.wixapis.com/site-properties/v4/properties/business-profile",
        status: 200,
        confirmed: (data) => Object.keys(data).length === 0,
        body: { businessProfile: { businessName: title }, fields: { paths: ["businessName"] } },
      };
  }
}
