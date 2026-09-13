import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createSiteAssetHandler } from "./handler.mjs";
import { siteHostingConfig } from "../src/lib/sites-policy.mjs";

const config = siteHostingConfig(process.env);
if (!config) throw new Error("Isolated Site hosting has not been configured and approved");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Site data access has not been configured");
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handle = createSiteAssetHandler({ admin, env: process.env });
const port = Number(process.env.PORT ?? 8081);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid Site server port");
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end('{"ok":true,"service":"kova-sites-assets"}');
      return;
    }
    const host = req.headers.host;
    if (!host || !/^[a-z0-9.-]+$/iu.test(host) || !host.endsWith("." + config.assetHost)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      res.writeHead(400);
      res.end();
      return;
    }
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 200) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const request = new Request("https://" + host + req.url, {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      ),
      body,
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503, { "Cache-Control": "no-store" });
    res.end("Site unavailable");
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxHeadersCount = 40;
server.listen(port, "0.0.0.0");
