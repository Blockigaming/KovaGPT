import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIPv4 } from "node:net";
import { Readable } from "node:stream";

const serverIdPattern = /^[a-z0-9][a-z0-9-]{1,47}$/u;
const toolNamePattern = /^[A-Za-z0-9_.-]{1,128}$/u;
const argumentPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

export function approvedMcpServers(source = process.env.KOVA_MCP_READ_SERVERS) {
  if (!source || source.length > 24_000) return new Map();
  try {
    const entries = JSON.parse(source);
    if (!Array.isArray(entries) || entries.length > 30) return new Map();
    const servers = new Map();
    for (const { id, url, tool, queryField, writeTool, writeField } of entries) {
      const endpoint = new URL(url);
      if (
        typeof id !== "string" ||
        !serverIdPattern.test(id) ||
        servers.has(id) ||
        typeof tool !== "string" ||
        !toolNamePattern.test(tool) ||
        typeof queryField !== "string" ||
        !argumentPattern.test(queryField) ||
        ((writeTool !== undefined || writeField !== undefined) &&
          (typeof writeTool !== "string" ||
            !toolNamePattern.test(writeTool) ||
            writeTool === tool ||
            typeof writeField !== "string" ||
            !argumentPattern.test(writeField))) ||
        endpoint.protocol !== "https:" ||
        !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/u.test(endpoint.hostname) ||
        endpoint.hostname.endsWith(".local") ||
        endpoint.hostname.endsWith(".localhost") ||
        endpoint.hostname.endsWith(".internal") ||
        endpoint.username ||
        endpoint.password ||
        endpoint.port ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.href.length > 1_500
      )
        return new Map();
      const binding = { url: endpoint.href, tool, queryField };
      const fingerprint = createHash("sha256").update(JSON.stringify(binding)).digest("base64url");
      const write = writeTool
        ? {
            tool: writeTool,
            field: writeField,
            fingerprint: createHash("sha256")
              .update(JSON.stringify({ fingerprint, writeTool, writeField }))
              .digest("base64url"),
          }
        : null;
      servers.set(id, { ...binding, fingerprint, write });
    }
    return servers;
  } catch {
    return new Map();
  }
}

const reserved = new BlockList();
for (const [address, subnet] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32], // Azure host services address.
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]) {
  reserved.addSubnet(address, subnet);
}

export function isPublicMcpAddress(address) {
  return isIPv4(address) && !reserved.check(address, "ipv4");
}

// Resolve once per call and use that address for the authenticated TLS
// connection. The configured hostname remains the SNI/verification name.
export async function fetchApprovedMcp(url, init) {
  const endpoint = new URL(url);
  const signal = init.signal;
  signal.throwIfAborted();
  const addresses = await new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    lookup(endpoint.hostname, { all: true, family: 4 })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
  if (!addresses.length || addresses.some(({ address }) => !isPublicMcpAddress(address)))
    throw new Error("invalid_mcp_server_address");

  return new Promise((resolve, reject) => {
    const req = request(
      endpoint,
      {
        agent: false,
        method: init.method,
        headers: init.headers,
        signal,
        family: 4,
        lookup: (_name, options, callback) => {
          if (options.all) callback(null, addresses.slice(0, 1));
          else callback(null, addresses[0].address, 4);
        },
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") headers.set(key, value);
        }
        const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(incoming);
        if (!body) incoming.resume();
        resolve(new Response(body, { status, headers }));
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}
