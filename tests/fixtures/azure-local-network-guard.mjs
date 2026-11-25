import { ServerResponse } from "node:http";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { loopbackPreviewHeaders } from "../helpers/loopback-preview-headers.mjs";

// Test-process boundary only; never imported by production source. The local
// preview receives no provider/database credentials and may connect only to its
// own loopback listener. Browser egress is independently blocked in the suite.
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("azure_local_test_port_required");
}
const hosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const deny = () => {
  throw new Error("azure_local_test_outbound_denied");
};
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const options =
    first && typeof first === "object"
      ? first
      : { port: first, host: typeof normalized[1] === "string" ? normalized[1] : "localhost" };
  if (options.path || !hosts.has(options.host ?? "localhost") || Number(options.port) !== port)
    deny();
  return Reflect.apply(nativeConnect, this, args);
};
syncBuiltinESMExports();

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol !== "http:" || !hosts.has(url.hostname) || Number(url.port) !== port) deny();
  return nativeFetch(input, { ...init, redirect: "error" });
};

// The browser follows real redirects, including WebKit where intercepted
// redirects cannot be fulfilled. Apply the HTTP preview policy at the listener
// so the final document is covered even when the browser skips its route handler.
if (process.env.AZURE_ENVIRONMENT === "ci" && process.env.HOST === "127.0.0.1") {
  const previewUrl = `http://127.0.0.1:${port}`;
  const previewHeader = (name, value) => {
    if (name.toLowerCase() !== "content-security-policy" || typeof value !== "string") {
      return value;
    }
    return loopbackPreviewHeaders(previewUrl, { "content-security-policy": value })[
      "content-security-policy"
    ];
  };
  const setHeader = ServerResponse.prototype.setHeader;
  ServerResponse.prototype.setHeader = function (name, value) {
    return Reflect.apply(setHeader, this, [name, previewHeader(name, value)]);
  };
  // Nitro can pass a complete header collection directly to writeHead rather
  // than calling setHeader. Cover both Node response paths, including redirects.
  const writeHead = ServerResponse.prototype.writeHead;
  ServerResponse.prototype.writeHead = function (statusCode, ...args) {
    const index = typeof args[0] === "string" ? 1 : 0;
    const headers = args[index];
    if (Array.isArray(headers)) {
      args[index] = headers.map((value, i) =>
        i % 2 === 1 ? previewHeader(String(headers[i - 1]), value) : value,
      );
    } else if (headers && typeof headers === "object") {
      args[index] = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, previewHeader(name, value)]),
      );
    }
    return Reflect.apply(writeHead, this, [statusCode, ...args]);
  };
}
