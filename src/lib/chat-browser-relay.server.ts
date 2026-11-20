import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { RealtimeClient, RealtimeChannel } from "@supabase/supabase-js";
import {
  cloudBrowserId,
  parseCloudBrowserControl,
  type CloudBrowserControl,
  type CloudBrowserFrame,
} from "./cloud-browser-control.ts";

type Command = {
  id: string;
  expiresAt: number;
  ownerId: string;
  requestId: string;
  action: CloudBrowserControl;
};
export type BrowserControlResult =
  | { frame: CloudBrowserFrame | null }
  | { error: { code: string; message: string; status: number } };

const COMMAND_MS = 2500;
const RESPONSE_MS = 8500;
const MAX_PACKET = 245_000;
export const maxBrowserFrameBytes = 126_000;

export class ChatBrowserRelay {
  readonly #channel: RealtimeChannel;
  readonly #key: Buffer;
  readonly #waiting = new Map<string, (result: BrowserControlResult) => void>();
  readonly #seen = new Map<string, number>();
  readonly #ready: Promise<void>;

  constructor(
    client: RealtimeClient,
    serviceKey: string,
    findHandler: (
      ownerId: string,
      requestId: string,
    ) => ((action: CloudBrowserControl) => Promise<BrowserControlResult>) | undefined,
  ) {
    // Only server replicas know the topic and the separate encryption key. No
    // browser frames, keyboard input, or replay tokens are stored in the database.
    const topic = createHmac("sha256", serviceKey)
      .update("kova-chat-browser-relay-topic-v1")
      .digest("hex");
    this.#key = createHmac("sha256", serviceKey).update("kova-chat-browser-relay-key-v1").digest();
    this.#channel = client.channel(topic, { config: { private: true, broadcast: { ack: true } } });
    this.#channel.on("broadcast", { event: "command" }, ({ payload }) => {
      const command = this.#read<Command>("command", payload);
      if (!command || !cloudBrowserId.test(command.id)) return;
      const now = Date.now();
      if (!(command.expiresAt > now && command.expiresAt <= now + COMMAND_MS + 1000)) return;
      const handler = findHandler(command.ownerId, command.requestId);
      if (!handler) return;
      for (const [id, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(id);
      if (this.#seen.has(command.id)) return;
      const action = parseCloudBrowserControl(command.action);
      if (!action) return;
      this.#seen.set(command.id, command.expiresAt);
      void handler(action)
        .then((result) => this.#send("result", { id: command.id, result }))
        .catch(() => undefined);
    });
    this.#channel.on("broadcast", { event: "result" }, ({ payload }) => {
      const response = this.#read<{ id: string; result: BrowserControlResult }>("result", payload);
      if (response) this.#waiting.get(response.id)?.(response.result);
    });
    this.#ready = new Promise<void>((resolve, reject) => {
      void client
        .setAuth(serviceKey)
        .then(() => {
          this.#channel.subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
          });
        })
        .catch(reject);
    });
    // Initial connection attempts also happen when the first request only needs a preview.
    void this.#ready.catch(() => undefined);
  }

  async forward(ownerId: string, requestId: string, action: CloudBrowserControl) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = randomUUID();
    const deadline = Date.now() + RESPONSE_MS;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("browser_control_unavailable")), RESPONSE_MS);
        }),
        this.#ready.then(async () => {
          // One broadcast per command. A timeout cannot trigger another click or keystroke.
          if (Date.now() >= deadline) throw new Error("browser_control_unavailable");
          const response = new Promise<BrowserControlResult>((resolve) =>
            this.#waiting.set(id, resolve),
          );
          await this.#send("command", {
            id,
            ownerId,
            requestId,
            action,
            expiresAt: Math.min(deadline, Date.now() + COMMAND_MS),
          });
          return response;
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.#waiting.delete(id);
    }
  }

  async #send(event: "command" | "result", value: object) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(event));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
    if (sealed.length > MAX_PACKET) throw new Error("browser_control_packet_too_large");
    const sent = await this.#channel.send({ type: "broadcast", event, payload: { sealed } });
    if (sent !== "ok") throw new Error("browser_control_unavailable");
  }

  #read<T>(event: "command" | "result", payload: unknown): T | undefined {
    if (!payload || typeof payload !== "object" || !("sealed" in payload)) return;
    const { sealed } = payload;
    if (typeof sealed !== "string" || sealed.length > MAX_PACKET) return;
    try {
      const bytes = Buffer.from(sealed, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", this.#key, bytes.subarray(0, 12), {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(event));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
      ) as T;
    } catch {
      return;
    }
  }
}
