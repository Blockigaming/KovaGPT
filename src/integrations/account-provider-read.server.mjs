import { createHash, createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { readProviderJsonObject, readProviderText } from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS } from "./connection-flows.mjs";
import { unpackKeyCredential, WEBULL_ORIGINS } from "./key-connection-credential.server.mjs";

const MAX_ROWS = 10;
const FLEX_ENDPOINT = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/";
const CAPITAL_IQ_ENDPOINT = "https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/";
const COMPANY_MATCH = "KL_PRO_ENTITY_ID_NAME_QUICK_MATCH";
const WIX_ORIGIN = "https://www.wixapis.com";
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
  maxNestedTags: 30,
});

function invalidResponse() {
  return new Error("invalid_connection_response");
}

async function request(fetchImpl, url, signal, init = {}) {
  const response = await fetchImpl(String(url), { ...init, signal, redirect: "error" });
  if (response.ok) return response;
  await response.body?.cancel().catch(() => undefined);
  const statusCodes = {
    401: "connection_reauthorization_required",
    403: "connection_permission_required",
    429: "connection_rate_limited",
  };
  throw new Error(statusCodes[response.status] ?? "connection_read_failed");
}

function bearerToken(data) {
  if (
    typeof data.access_token !== "string" ||
    !/^[!-~]{8,8192}$/u.test(data.access_token) ||
    String(data.token_type).toLowerCase() !== "bearer"
  )
    throw invalidResponse();
  return data.access_token;
}

function readResult(id, rows, truncated = false) {
  return {
    service: CONNECTION_FLOWS[id].label,
    results: rows.slice(0, MAX_ROWS),
    limited: truncated || rows.length > MAX_ROWS,
  };
}

function oneOrMany(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

async function readFlexXml(fetchImpl, signal, path, token, id) {
  const url = new URL(path, FLEX_ENDPOINT);
  url.search = new URLSearchParams({ t: token, q: id, v: "3" }).toString();
  const response = await request(fetchImpl, url, signal, {
    headers: { Accept: "application/xml, text/xml" },
  });
  const xml = await readProviderText(response, 512_000);
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml) || XMLValidator.validate(xml) !== true)
    throw invalidResponse();
  return xmlParser.parse(xml);
}

function flexFailure(code) {
  const codes = {
    1012: "connection_reauthorization_required",
    1013: "connection_permission_required",
    1014: "connection_permission_required",
    1015: "connection_reauthorization_required",
    1018: "connection_rate_limited",
    1019: "connection_report_pending",
  };
  throw new Error(codes[code] ?? "connection_read_failed");
}

async function readFlexPositions(query, { apiKey, queryId }, fetchImpl, signal) {
  if (!["recent", "positions"].includes(query.toLowerCase()))
    throw new Error("invalid_connection_query");
  const ticket = (await readFlexXml(fetchImpl, signal, "SendRequest", apiKey, queryId))
    .FlexStatementResponse;
  if (ticket?.Status !== "Success") flexFailure(ticket?.ErrorCode);
  const reference = ticket.ReferenceCode;
  if (typeof reference !== "string" || !/^[0-9]{1,30}$/u.test(reference)) throw invalidResponse();

  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(1_100, undefined, { signal });
    const data = await readFlexXml(fetchImpl, signal, "GetStatement", apiKey, reference);
    if (data.FlexStatementResponse) {
      if (data.FlexStatementResponse.ErrorCode === "1019") continue;
      flexFailure(data.FlexStatementResponse.ErrorCode);
    }
    const statements = oneOrMany(data.FlexQueryResponse?.FlexStatements?.FlexStatement);
    if (
      !statements.length ||
      statements.some((statement) => !Object.hasOwn(statement, "OpenPositions"))
    )
      throw new Error("connection_permission_required");
    const positions = statements.flatMap((statement) =>
      oneOrMany(statement.OpenPositions?.OpenPosition),
    );
    const rows = positions.slice(0, MAX_ROWS).map((position, index) => {
      const { "@_symbol": symbol, "@_currency": currency, "@_position": quantity } = position;
      if (
        typeof symbol !== "string" ||
        !/^[^\u0000-\u001f\u007f]{1,120}$/u.test(symbol) ||
        typeof currency !== "string" ||
        !/^[A-Z]{3}$/u.test(currency) ||
        typeof quantity !== "string" ||
        !/^-?\d{1,20}(?:\.\d{1,18})?$/u.test(quantity)
      )
        throw invalidResponse();
      return {
        id: String(index + 1),
        title: symbol,
        snippet: `Quantity ${quantity} · ${currency}`,
        url: null,
      };
    });
    return readResult("interactive-brokers", rows, positions.length > MAX_ROWS);
  }
  flexFailure("1019");
}

async function matchCapitalIqCompany(query, { apiKey, username }, fetchImpl, signal) {
  const token = bearerToken(
    await readProviderJsonObject(
      await request(fetchImpl, new URL("authenticate/api/v1/token", CAPITAL_IQ_ENDPOINT), signal, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ username, password: apiKey }),
      }),
      24_000,
    ),
  );
  const data = await readProviderJsonObject(
    await request(fetchImpl, new URL("v3/clientservice.json", CAPITAL_IQ_ENDPOINT), signal, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        inputRequests: [
          {
            function: "GDSPV",
            identifier: query,
            mnemonic: COMPANY_MATCH,
            properties: { UID: "1", include_response_fields: "countryname,simple_industry" },
          },
        ],
      }),
    }),
    256_000,
  );
  if (!Array.isArray(data.GDSSDKResponse) || data.GDSSDKResponse.length !== 1)
    throw invalidResponse();
  const result = data.GDSSDKResponse[0];
  if (result?.ErrMsg) throw new Error("connection_read_failed");
  if (result?.Mnemonic !== COMPANY_MATCH || !Array.isArray(result.Rows)) throw invalidResponse();
  if (!result.Rows.length) return readResult("sp-global", []);
  if (!Array.isArray(result.Headers)) throw invalidResponse();
  const fields = Object.fromEntries(
    ["UID", "CIQCOMPANYID", "COMPANYNAME", "COUNTRYNAME", "SIMPLE_INDUSTRY"].map((name) => [
      name,
      result.Headers.indexOf(name),
    ]),
  );
  if ([fields.UID, fields.CIQCOMPANYID, fields.COMPANYNAME].includes(-1)) throw invalidResponse();
  const rows = result.Rows.slice(0, MAX_ROWS).map(({ Row }) => {
    if (!Array.isArray(Row) || Row[fields.UID] !== "1") throw invalidResponse();
    const id = Row[fields.CIQCOMPANYID];
    const title = Row[fields.COMPANYNAME];
    if (
      typeof id !== "string" ||
      !/^IQ[0-9]{1,20}$/u.test(id) ||
      typeof title !== "string" ||
      !title.trim()
    )
      throw invalidResponse();
    return {
      id,
      title: title.slice(0, 300),
      snippet: [Row[fields.COUNTRYNAME], Row[fields.SIMPLE_INDUSTRY]]
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.slice(0, 160))
        .join(" · "),
      url: null,
    };
  });
  return readResult("sp-global", rows, result.Rows.length > MAX_ROWS);
}

export function webullSignedHeaders(url, { apiKey, appKey, accessToken }, body) {
  const signingHeaders = {
    "x-app-key": appKey,
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-nonce": randomUUID().replaceAll("-", ""),
    "x-signature-version": "1.0",
    "x-timestamp": new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
  };
  const canonical = Object.entries({
    ...Object.fromEntries(url.searchParams),
    host: url.host,
    ...signingHeaders,
  })
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const digest = body ? `&${createHash("md5").update(body).digest("hex").toUpperCase()}` : "";
  const signature = createHmac("sha1", `${apiKey}&`)
    .update(encodeURIComponent(`${url.pathname}&${canonical}${digest}`))
    .digest("base64");
  return {
    ...signingHeaders,
    "x-signature": signature,
    "x-version": "v3",
    ...(accessToken ? { "x-access-token": accessToken } : {}),
    Accept: "application/json",
  };
}

async function listWebullAccounts(query, credential, fetchImpl, signal) {
  if (!["recent", "accounts"].includes(query.toLowerCase()))
    throw new Error("invalid_connection_query");
  const url = new URL("/trading/accounts/list", WEBULL_ORIGINS[credential.environment]);
  const response = await request(fetchImpl, url, signal, {
    headers: webullSignedHeaders(url, credential),
  });
  const accounts = JSON.parse(await readProviderText(response, 128_000));
  if (!Array.isArray(accounts)) throw invalidResponse();
  const rows = accounts.slice(0, MAX_ROWS).map((account, index) => {
    if (
      typeof account?.account_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/u.test(account.account_id)
    )
      throw invalidResponse();
    const type = typeof account.account_type === "string" ? account.account_type.slice(0, 80) : "";
    return { id: String(index + 1), title: `Account ${index + 1}`, snippet: type, url: null };
  });
  return readResult("webull", rows, accounts.length > MAX_ROWS);
}

export async function getWixAccessToken({ apiKey, clientId }, fetchImpl, signal) {
  return bearerToken(
    await readProviderJsonObject(
      await request(fetchImpl, new URL("/oauth2/token", WIX_ORIGIN), signal, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: apiKey,
        }),
      }),
      24_000,
    ),
  );
}

async function readWixSite(query, credential, fetchImpl, signal) {
  if (!["recent", "site"].includes(query.toLowerCase()))
    throw new Error("invalid_connection_query");
  const token = await getWixAccessToken(credential, fetchImpl, signal);
  const url = new URL("/site-properties/v4/properties", WIX_ORIGIN);
  url.searchParams.append("fields.paths", "businessName");
  url.searchParams.append("fields.paths", "locale");
  const data = await readProviderJsonObject(
    await request(fetchImpl, url, signal, {
      headers: { Authorization: token, Accept: "application/json" },
    }),
    64_000,
  );
  const properties = data.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties) ||
    typeof data.version !== "string"
  )
    throw invalidResponse();
  const name = typeof properties.businessName === "string" ? properties.businessName.trim() : "";
  const locale = [properties.locale?.languageCode, properties.locale?.country]
    .filter((value) => typeof value === "string" && /^[A-Za-z-]{2,15}$/u.test(value))
    .join("-");
  return readResult("wix", [
    { id: "site-properties", title: name.slice(0, 300) || "Wix site", snippet: locale, url: null },
  ]);
}

const reads = Object.freeze({
  "interactive-brokers": readFlexPositions,
  "sp-global": matchCapitalIqCompany,
  webull: listWebullAccounts,
  wix: readWixSite,
});

export function isAccountProviderRead(id) {
  return Object.hasOwn(reads, id);
}

export function readAccountProvider(id, query, token, fetchImpl) {
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 300 ||
    /[\u0000-\u001f\u007f]/u.test(query)
  )
    throw new Error("invalid_connection_query");
  return reads[id](
    query.trim(),
    unpackKeyCredential(id, token),
    fetchImpl,
    AbortSignal.timeout(18_000),
  );
}
