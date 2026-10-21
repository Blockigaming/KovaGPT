import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

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
