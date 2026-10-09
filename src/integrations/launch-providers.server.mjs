import { ConnectorError, requirePermissions, validateOperation } from "./launch-contracts.mjs";
import {
  bearerHeaders,
  jsonPost,
  providerRequest,
  salesforceOrigin,
} from "./launch-http.server.mjs";
import { NOTION_VERSION } from "./launch-oauth.server.mjs";
const PAGE_SIZE = 25;
const string = (v, limit = 16_000) => (typeof v === "string" ? v.slice(0, limit) : "");
const segment = (v) => encodeURIComponent(v);
const rows = (v) => {
  if (!Array.isArray(v) || v.length > 50) throw new ConnectorError("provider_response_invalid");
  return v;
};
const richText = (v) =>
  Array.isArray(v)
    ? v
        .map((t) => string(t.plain_text || t.text?.content))
        .join("")
        .slice(0, 16_000)
    : "";
const httpsLink = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
};
const fileFields = "id,name,size,webUrl,file,folder,lastModifiedDateTime";
const file = (v) => ({
  id: string(v.id),
  name: string(v.name),
  size: typeof v.size === "number" ? v.size : null,
  url: httpsLink(v.webUrl),
  kind: v.folder ? "folder" : "file",
  mimeType: string(v.file?.mimeType),
  modifiedAt: string(v.lastModifiedDateTime),
});
const message = (v) => ({
  id: string(v.id),
  subject: string(v.subject),
  from: string(v.from?.emailAddress?.address),
  text: string(v.body?.content || v.bodyPreview),
  contentType: v.body?.contentType === "html" ? "html" : "text",
  receivedAt: string(v.receivedDateTime),
  url: httpsLink(v.webLink),
});
const notionPage = (v) => ({
  id: string(v.id),
  object: string(v.object),
  url: httpsLink(v.url),
  title: richText(
    v.title || Object.values(v.properties || {}).find((p) => p?.type === "title")?.title,
  ),
});
const issue = (v) => ({
  id: string(v.id),
  identifier: string(v.identifier),
  title: string(v.title),
  description: string(v.description),
  url: httpsLink(v.url),
  state: string(v.state?.name),
});
const contact = (v) => ({
  id: string(v.id),
  firstName: string(v.properties?.firstname),
  lastName: string(v.properties?.lastname),
  email: string(v.properties?.email),
  modifiedAt: string(v.updatedAt),
});
const sfAccount = (v) => ({ id: string(v.Id), name: string(v.Name), industry: string(v.Industry) });
function graphNext(next, initial) {
  if (!next) return initial;
  let u;
  try {
    u = new URL(next);
  } catch {
    throw new ConnectorError("invalid_cursor", 400);
  }
  if (
    u.origin !== "https://graph.microsoft.com" ||
    u.pathname !== initial.pathname ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new ConnectorError("invalid_cursor", 400);
  return u;
}
function cursorString(value) {
  if (typeof value !== "string" || !value || value.length > 8000 || /[\x00-\x1f]/.test(value))
    throw new ConnectorError("invalid_cursor", 400);
  return value;
}
export async function executeProviderRead(
  id,
  operation,
  rawArgs,
  token,
  cursor = null,
  transport = {},
) {
  const args = validateOperation(id, operation, rawArgs);
  requirePermissions(id, token.scopes);
  const headers = bearerHeaders(token.accessToken);
  const request = (url, init = {}) =>
    providerRequest(
      url.toString(),
      { ...init, headers: { ...headers, ...init.headers } },
      transport,
    );
  let items,
    next = null;
  if (["outlook", "onedrive", "sharepoint", "ms-teams"].includes(id)) {
    let path,
      query = {},
      single = false;
    if (id === "outlook") {
      single = operation === "read_message";
      path = single ? `/me/messages/${segment(args.id)}` : "/me/messages";
      query = {
        $select: single
          ? "id,subject,from,body,receivedDateTime,webLink"
          : "id,subject,from,bodyPreview,receivedDateTime,webLink",
      };
    } else if (id === "onedrive" || (id === "sharepoint" && operation !== "search_sites")) {
      const root = id === "onedrive" ? "/me/drive" : `/sites/${segment(args.siteId)}/drive`;
      single = operation === "get_file";
      path = single
        ? `${root}/items/${segment(args.id)}`
        : args.folderId
          ? `${root}/items/${segment(args.folderId)}/children`
          : `${root}/root/children`;
      query = { $select: fileFields };
    } else if (id === "sharepoint") {
      path = "/sites";
      query = { search: args.query, $select: "id,displayName,webUrl" };
    } else
      path = operation === "list_chats" ? "/me/chats" : `/chats/${segment(args.chatId)}/messages`;
    if (!single) query.$top = String(PAGE_SIZE);
    else if (cursor) throw new ConnectorError("invalid_cursor", 400);
    const initial = new URL(`https://graph.microsoft.com/v1.0${path}`);
    initial.search = new URLSearchParams(query).toString();
    const data = await request(
      graphNext(cursor, initial),
      id === "outlook" ? { headers: { Prefer: 'outlook.body-content-type="text"' } } : {},
    );
    const values = single ? [data] : rows(data.value);
    if (id === "outlook") items = values.map(message);
    else if (id === "onedrive" || (id === "sharepoint" && operation !== "search_sites"))
      items = values.map(file);
    else if (id === "sharepoint")
      items = values.map((v) => ({
        id: string(v.id),
        name: string(v.displayName),
        url: httpsLink(v.webUrl),
      }));
    else
      items =
        operation === "list_chats"
          ? values.map((v) => ({
              id: string(v.id),
              topic: string(v.topic),
              type: string(v.chatType),
              url: httpsLink(v.webUrl),
            }))
          : values.map((v) => ({
              id: string(v.id),
              text: string(v.body?.content),
              contentType: v.body?.contentType === "html" ? "html" : "text",
              from: string(v.from?.user?.displayName),
              createdAt: string(v.createdDateTime),
              url: httpsLink(v.webUrl),
            }));
    if (data["@odata.nextLink"]) next = graphNext(data["@odata.nextLink"], initial).toString();
  } else if (id === "notion") {
    const notionHeaders = { "Notion-Version": NOTION_VERSION };
    let data;
    if (operation === "search") {
      data = await request(
        "https://api.notion.com/v1/search",
        jsonPost(
          {
            ...(args.query ? { query: args.query } : {}),
            page_size: PAGE_SIZE,
            ...(cursor ? { start_cursor: cursorString(cursor) } : {}),
          },
          notionHeaders,
        ),
      );
      items = rows(data.results).map(notionPage);
    } else if (operation === "get_page") {
      if (cursor) throw new ConnectorError("invalid_cursor", 400);
      data = await request(`https://api.notion.com/v1/pages/${segment(args.id)}`, {
        headers: notionHeaders,
      });
      items = [notionPage(data)];
    } else {
      const url = new URL(`https://api.notion.com/v1/blocks/${segment(args.id)}/children`);
      url.searchParams.set("page_size", String(PAGE_SIZE));
      if (cursor) url.searchParams.set("start_cursor", cursorString(cursor));
      data = await request(url, { headers: notionHeaders });
      items = rows(data.results).map((v) => ({
        id: string(v.id),
        type: string(v.type),
        text: richText(v[v.type]?.rich_text),
        hasChildren: v.has_children === true,
      }));
    }
    if (data.has_more === true) next = cursorString(data.next_cursor);
  } else if (id === "linear") {
    const single = operation === "get_issue";
    if (single && cursor) throw new ConnectorError("invalid_cursor", 400);
    const fields = "id identifier title description url state { name }";
    const query = single
      ? `query KovaIssue($id: String!) { issue(id: $id) { ${fields} } }`
      : `query KovaIssues($after: String) { issues(first: 25, after: $after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } }`;
    const data = await request(
      "https://api.linear.app/graphql",
      jsonPost({
        query,
        variables: single ? { id: args.id } : { after: cursor ? cursorString(cursor) : null },
      }),
    );
    if (!data.data || (single && !data.data.issue))
      throw new ConnectorError("provider_response_invalid");
    items = single ? [issue(data.data.issue)] : rows(data.data.issues?.nodes).map(issue);
    if (data.data.issues?.pageInfo?.hasNextPage)
      next = cursorString(data.data.issues.pageInfo.endCursor);
  } else if (id === "slack") {
    const page = cursor === null ? 1 : Number(cursor);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100)
      throw new ConnectorError("invalid_cursor", 400);
    const url = new URL("https://slack.com/api/search.messages");
    url.search = new URLSearchParams({
      query: args.query,
      count: String(PAGE_SIZE),
      page: String(page),
      highlight: "false",
    }).toString();
    const data = await request(url);
    items = rows(data.messages?.matches).map((v) => ({
      id: string(v.ts),
      text: string(v.text),
      user: string(v.user),
      channelId: string(v.channel?.id),
      channel: string(v.channel?.name),
      url: httpsLink(v.permalink),
    }));
    if (Number(data.messages?.paging?.pages) > page) next = String(page + 1);
  } else if (id === "salesforce") {
    const origin = salesforceOrigin(token.origin);
    let url;
    if (operation === "get_account") {
      if (cursor) throw new ConnectorError("invalid_cursor", 400);
      url = `${origin}/services/data/v61.0/sobjects/Account/${args.id}?fields=Id,Name,Industry`;
    } else if (cursor) {
      if (!/^\/services\/data\/v61\.0\/query\/[A-Za-z0-9-]+$/.test(cursor))
        throw new ConnectorError("invalid_cursor", 400);
      url = origin + cursor;
    } else {
      const initial = new URL(`${origin}/services/data/v61.0/query`);
      initial.searchParams.set("q", "SELECT Id, Name, Industry FROM Account ORDER BY Id");
      url = initial.toString();
    }
    const data = await request(url, { headers: { "Sforce-Query-Options": "batchSize=200" } });
    // Salesforce's minimum batch size is 200. Preserve the entire bounded page.
    items =
      operation === "get_account"
        ? [sfAccount(data)]
        : Array.isArray(data.records)
          ? data.records.map(sfAccount)
          : rows(null);
    if (items.length > 200) throw new ConnectorError("provider_response_invalid");
    if (data.done === false) next = cursorString(data.nextRecordsUrl);
  } else if (id === "hubspot") {
    const properties = ["firstname", "lastname", "email"];
    if (operation === "get_contact") {
      if (cursor) throw new ConnectorError("invalid_cursor", 400);
      items = [
        contact(
          await request(
            `https://api.hubapi.com/crm/v3/objects/contacts/${segment(args.id)}?properties=${properties.join(",")}`,
          ),
        ),
      ];
    } else {
      if (cursor && !/^\d{1,12}$/.test(cursor)) throw new ConnectorError("invalid_cursor", 400);
      const data = await request(
        "https://api.hubapi.com/crm/v3/objects/contacts/search",
        jsonPost({
          ...(args.query ? { query: args.query } : {}),
          properties,
          limit: PAGE_SIZE,
          ...(cursor ? { after: cursor } : {}),
        }),
      );
      items = rows(data.results).map(contact);
      if (data.paging?.next?.after !== undefined)
        next = cursorString(String(data.paging.next.after));
    }
  }
  if (!Array.isArray(items)) throw new ConnectorError("provider_response_invalid");
  return { items, next, contentIsUntrusted: true };
}
export const PROBE_OPERATIONS = Object.freeze({
  outlook: ["list_messages", {}],
  onedrive: ["list_files", {}],
  sharepoint: ["search_sites", { query: "kova-connectivity-check" }],
  "ms-teams": ["list_chats", {}],
  notion: ["search", {}],
  linear: ["list_issues", {}],
  slack: ["search_messages", { query: "kova-connectivity-check" }],
  salesforce: ["list_accounts", {}],
  hubspot: ["search_contacts", {}],
});
