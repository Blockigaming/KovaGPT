import { chromium } from "playwright";
import { createInteractiveBrowser } from "./driver.mjs";
import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
// Fail visibly if this fixed container entrypoint is accidentally invoked on a host.
if (process.getuid?.() !== 65532 || !existsSync("/.dockerenv") || !existsSync("/browser"))
  process.exit(1);
const expiresAt = Number(process.env.KOVA_BROWSER_EXPIRES_AT);
if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300000)
  process.exit(1);
const network = new Map(),
  decoder = new StringDecoder("utf8");
let queued = 0;
let input = "",
  pending = Promise.resolve(),
  closed = false;
const send = (value) => {
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > 3000000) throw new Error("browser_protocol_limit");
  process.stdout.write(raw + "\n");
};
const browser = await createInteractiveBrowser({
  chromium,
  exchange: (request, authority) =>
    new Promise((resolve, reject) => {
      if (closed || network.size >= 8) {
        reject(new Error("network_limit"));
        return;
      }
      const id = randomUUID(),
        timer = setTimeout(() => {
          network.delete(id);
          reject(new Error("network_timeout"));
        }, 12000);
      network.set(id, { resolve, reject, timer });
      send({ kind: "network", id, request, authority });
    }),
});
async function close() {
  if (closed) return;
  closed = true;
  for (const row of network.values()) {
    clearTimeout(row.timer);
    row.reject(new Error("closed"));
  }
  network.clear();
  await browser.close().catch(() => {});
  process.exit(0);
}
process.stdin.on("data", (chunk) => {
  input += decoder.write(chunk);
  if (Buffer.byteLength(input) > 4000000) {
    void close();
    return;
  }
  for (;;) {
    const end = input.indexOf("\n");
    if (end < 0) break;
    const raw = input.slice(0, end);
    input = input.slice(end + 1);
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      void close();
      return;
    }
    if (message.kind === "network_result") {
      const row = network.get(message.id);
      if (!row) continue;
      network.delete(message.id);
      clearTimeout(row.timer);
      message.error ? row.reject(new Error("network_denied")) : row.resolve(message.result);
    } else if (message.kind === "command") {
      if (++queued > 2) {
        void close();
        return;
      }
      pending = pending
        .then(async () => {
          try {
            const result = await browser.command(message.command);
            send({ kind: "result", id: message.id, result });
          } catch {
            send({ kind: "result", id: message.id, error: "work_browser_action_denied" });
          }
        })
        .catch(() => close())
        .finally(() => {
          queued--;
        });
    } else {
      void close();
      return;
    }
  }
});
process.stdin.on("end", () => void close());
process.on("SIGTERM", () => void close());
setTimeout(() => void close(), Math.max(1, expiresAt - Date.now())).unref();
send({ kind: "ready", protocol: "kova-browser-v1" });
